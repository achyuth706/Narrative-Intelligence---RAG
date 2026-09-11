"""Builds cache/ (crime + news chunks, deterministic links, FAISS indices)
from raw crime CSV + ProQuest news export data. This is the offline half of
the pipeline demoed in Final_Crime_Analysis_Narrative_Intelligence.ipynb —
run this before starting the API server (main.py / rag_system.py only read
the cache, they never build it).

Usage:
    python build_index.py                                  # bundled sample data
    python build_index.py --crime-csv ../Crimes_2018_to_Present.csv \\
                           --news-dir "../Chicago Tribune Data"       # full dataset
"""
import argparse
import gc
import glob
import json
import os
import re
import warnings

import faiss
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.environ.get("CACHE_DIR") or os.path.join(BASE_DIR, "cache")

CRIME_CHUNKS_FILE = os.path.join(CACHE_DIR, "crime_chunks.jsonl")
NEWS_CHUNKS_FILE = os.path.join(CACHE_DIR, "news_chunks.jsonl")
LINKS_FILE = os.path.join(CACHE_DIR, "crime_news_links.jsonl")
CRIME_INDEX_FILE = os.path.join(CACHE_DIR, "crime_index.faiss")
NEWS_INDEX_FILE = os.path.join(CACHE_DIR, "news_index.faiss")

DEFAULT_CRIME_CSV = os.path.join(BASE_DIR, "data", "sample", "Crimes_sample.csv")
DEFAULT_NEWS_DIR = os.path.join(BASE_DIR, "data", "sample", "Chicago Tribune Data")


# ---------------------------------------------------------------- helpers --

def json_safe(x):
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        return float(x)
    if isinstance(x, pd.Timestamp):
        return x.isoformat()
    return str(x)


def jsonl_line(obj):
    obj = {
        k: (json_safe(v) if not isinstance(v, dict) else {a: json_safe(b) for a, b in v.items()})
        for k, v in obj.items()
    }
    return json.dumps(obj) + "\n"


_WORD_RE = re.compile(r"[A-Za-z]+")


def tokenize(text):
    return set(w.lower() for w in _WORD_RE.findall(text or ""))


def extract_field(block, field_name):
    pattern = rf"{field_name}\s*:\s*(.*?)(?=\n[A-Za-z ]+\s*:|\Z)"
    match = re.search(pattern, block, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else None


def parse_proquest_file(path):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    blocks = re.split(r"_+\s*\n", text)
    articles = []
    for block in blocks:
        block = block.strip()
        if len(block) < 50:
            continue

        title = extract_field(block, "Title")
        author = extract_field(block, "Author")
        pubdate = extract_field(block, "Publication date")
        doctype = extract_field(block, "Document type")
        subject = extract_field(block, "Subject")
        fulltext = extract_field(block, "Full text")

        if not title:
            title = block.splitlines()[0].strip()[:150]
        if not fulltext:
            fulltext = "\n".join(block.splitlines()).strip()

        articles.append(
            {
                "Title": title,
                "Author": author,
                "PublicationDateRaw": pubdate,
                "DocumentType": doctype,
                "Subject": subject,
                "FullText": fulltext,
            }
        )
    return articles


def load_news(news_dir):
    txt_files = glob.glob(os.path.join(news_dir, "*.txt"))
    print(f"Found {len(txt_files)} news export files in {news_dir}")
    all_articles = []
    for file in txt_files:
        parsed = parse_proquest_file(file)
        print(f"  parsed {len(parsed):4d} articles from {os.path.basename(file)}")
        all_articles.extend(parsed)

    news_df = pd.DataFrame(all_articles)
    # NOTE: format="mixed" matters here — pandas infers a single format from
    # the first value and silently NaTs every row that doesn't match it,
    # which (unfixed) drops the vast majority of ProQuest "Mon D, YYYY" dates.
    news_df["PublicationDate"] = pd.to_datetime(news_df["PublicationDateRaw"], errors="coerce", format="mixed")
    print(f"News articles parsed: {len(news_df)} (valid dates: {news_df['PublicationDate'].notna().sum()})")
    return news_df


def load_crime(csv_path):
    crime_df = pd.read_csv(csv_path, low_memory=False)
    crime_df["Date"] = pd.to_datetime(crime_df["Date"], format="mixed")
    print(f"Crime records loaded: {len(crime_df)}")
    return crime_df


# ------------------------------------------------------------- pipeline ---

def build_crime_chunks(crime_df, min_crimes):
    print("Building crime chunks...")
    g = crime_df.groupby(["Primary Type", "Block", crime_df["Date"].dt.date])
    n_written = 0
    with open(CRIME_CHUNKS_FILE, "w", encoding="utf-8") as f:
        for (ptype, block, day), grp in tqdm(g, total=g.ngroups):
            if len(grp) < min_crimes:
                continue
            text = f"""Crime Report Summary
Type: {ptype}
Block: {block}
Date: {day}
Incidents: {len(grp)}
Arrests: {grp['Arrest'].sum()}
Latitude: {grp['Latitude'].mean()}
Longitude: {grp['Longitude'].mean()}
"""
            metadata = {"primary_type": ptype, "block": block, "date": str(day), "count": len(grp)}
            f.write(jsonl_line({"text": text, "metadata": metadata}))
            n_written += 1
    print(f"Crime chunks written: {n_written}")


def build_news_chunks(news_df, max_len):
    print("Building news chunks...")
    with open(NEWS_CHUNKS_FILE, "w", encoding="utf-8") as f:
        for _, row in tqdm(news_df.iterrows(), total=len(news_df)):
            text = f"Title: {row['Title']}\n\n{row['FullText']}"
            metadata = {
                "title": str(row["Title"]),
                "date": str(row["PublicationDate"]),
                "subject": str(row.get("Subject")),
            }
            f.write(jsonl_line({"text": text[:max_len], "metadata": metadata}))
    print(f"News chunks written: {len(news_df)}")


def build_links(crime_df, news_df, days_window, max_street_df=0.03):
    """Same matching rule as the original notebook (a street-name word and a
    crime-type word both appearing somewhere in an article, within +/- N
    days) but restructured to avoid an O(crimes x articles) full-text scan,
    and with one added precision fix:

    1. Sort articles by date once -> each crime's date window becomes a
       binary search (np.searchsorted) instead of a linear pandas filter.
    2. Build an inverted index once: lowercase word -> sorted array of
       article positions (in that same date-sorted order) containing it.
       Matching a crime then means intersecting two small position arrays
       within the window range, instead of re-scanning every article's
       full text per crime.
    3. Some Chicago streets are named after common words/directions (State,
       Michigan, North, Central...) or, worse, words that show up in any
       news text for unrelated reasons ("Chicago" itself; "May" the month).
       A street word is only used as a match key if it appears in under
       `max_street_df` of ALL articles -- real street names (Whipple,
       Kenmore, Paulina) sit under 2% document frequency in this corpus;
       the generic ones start above 4% and go up to 78% for "chicago".
       This is data-driven per corpus, not a hardcoded stopword list.
    """
    print("Building deterministic crime <-> news links...")

    dated = news_df[news_df["PublicationDate"].notna()].sort_values("PublicationDate")
    dated = dated.reset_index(drop=True)
    dates_ns = dated["PublicationDate"].values.astype("datetime64[ns]")
    titles = dated["Title"].to_numpy()
    pub_dates = dated["PublicationDate"].astype(str).to_numpy()
    n_articles = len(dated)

    print("  indexing article text...")
    token_positions = {}
    for pos, text in enumerate(tqdm(dated["FullText"].tolist())):
        for tok in tokenize(text):
            token_positions.setdefault(tok, []).append(pos)
    token_positions = {tok: np.array(pos_list, dtype=np.int64) for tok, pos_list in token_positions.items()}
    empty = np.array([], dtype=np.int64)

    max_df_count = max_street_df * n_articles
    street_ok = {tok for tok, pos in token_positions.items() if len(pos) <= max_df_count}
    print(f"  {len(street_ok)}/{len(token_positions)} words are specific enough (<{max_street_df:.0%} of articles) to use as a street match")

    window_delta = np.timedelta64(days_window, "D")
    n_links = 0

    crime_dates = crime_df["Date"].values.astype("datetime64[ns]")
    crime_ptypes = crime_df["Primary Type"].to_numpy()
    crime_blocks = crime_df["Block"].to_numpy()

    with open(LINKS_FILE, "w", encoding="utf-8") as f:
        for date, ptype, block in tqdm(zip(crime_dates, crime_ptypes, crime_blocks), total=len(crime_df)):
            lo, hi = np.searchsorted(dates_ns, [date - window_delta, date + window_delta], side="right")
            if hi <= lo:
                continue

            tokens = block.split()
            street_key = (tokens[2] if len(tokens) > 2 else (tokens[-1] if tokens else block)).lower()
            type_key = ptype.split()[0].lower()

            if street_key not in street_ok:
                continue
            street_pos = token_positions.get(street_key, empty)
            type_pos = token_positions.get(type_key, empty)
            if street_pos.size == 0 or type_pos.size == 0:
                continue

            # narrow each token's article set to the date window, then intersect
            s_lo, s_hi = np.searchsorted(street_pos, [lo, hi])
            t_lo, t_hi = np.searchsorted(type_pos, [lo, hi])
            matches = np.intersect1d(street_pos[s_lo:s_hi], type_pos[t_lo:t_hi], assume_unique=True)
            if matches.size == 0:
                continue

            date_str = str(pd.Timestamp(date))
            for pos in matches:
                f.write(
                    jsonl_line(
                        {
                            "crime_type": ptype,
                            "crime_block": block,
                            "crime_date": date_str,
                            "news_title": titles[pos],
                            "news_date": pub_dates[pos],
                        }
                    )
                )
                n_links += 1
    print(f"Links written: {n_links}")


def build_vector_index(model, jsonl_file, output_index, batch_size=128):
    print(f"Building vector index: {output_index}")
    index = None
    texts = []

    def flush():
        nonlocal index, texts
        if not texts:
            return
        emb = model.encode(texts, convert_to_numpy=True, batch_size=16)
        if index is None:
            index = faiss.IndexFlatL2(emb.shape[1])
        index.add(emb.astype("float32"))
        texts = []
        gc.collect()

    with open(jsonl_file, "r", encoding="utf-8") as f:
        for line in tqdm(f):
            texts.append(json.loads(line)["text"])
            if len(texts) >= batch_size:
                flush()
    flush()

    if index is None:
        index = faiss.IndexFlatL2(model.get_sentence_embedding_dimension())
    faiss.write_index(index, output_index)
    print(f"Index saved: {output_index} ({index.ntotal} vectors)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--crime-csv", default=DEFAULT_CRIME_CSV)
    parser.add_argument("--news-dir", default=DEFAULT_NEWS_DIR)
    parser.add_argument("--min-crimes", type=int, default=5, help="min incidents per (type, block, day) to form a crime chunk")
    parser.add_argument("--days-window", type=int, default=3, help="+/- days for deterministic crime<->news linking")
    parser.add_argument(
        "--max-street-df",
        type=float,
        default=0.03,
        help="a street word only counts as a match key if it appears in under this fraction of all articles "
        "(filters out streets named after common words like State/Chicago/North/South/month names)",
    )
    parser.add_argument("--max-news-len", type=int, default=1500)
    parser.add_argument("--embedding-model", default="all-MiniLM-L6-v2")
    args = parser.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)

    crime_df = load_crime(args.crime_csv)
    news_df = load_news(args.news_dir)

    build_crime_chunks(crime_df, args.min_crimes)
    build_news_chunks(news_df, args.max_news_len)
    build_links(crime_df, news_df, args.days_window, max_street_df=args.max_street_df)

    model = SentenceTransformer(args.embedding_model)
    build_vector_index(model, CRIME_CHUNKS_FILE, CRIME_INDEX_FILE)
    build_vector_index(model, NEWS_CHUNKS_FILE, NEWS_INDEX_FILE)

    print("\nDone. cache/ is ready — you can now start the API server (uvicorn main:app --reload).")


if __name__ == "__main__":
    main()
