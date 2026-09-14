# Storying the Streets — How the Hybrid RAG Actually Works

A complete technical walkthrough of the Narrative Intelligence RAG pipeline, from raw
data to generated answer. Cross-referenced with `IS597_Group6_Final_Report.pdf`.

All code in this document is quoted from
`Final_Crime_Analysis_Narrative_Intelligence.ipynb`.

---

## Table of contents

1. [The problem this solves](#1-the-problem-this-solves)
2. [The two datasets](#2-the-two-datasets)
3. [Architecture: three tiers](#3-architecture-three-tiers)
4. [Build phase, step by step](#4-build-phase-step-by-step)
5. [**What happens when a user enters a query**](#5-what-happens-when-a-user-enters-a-query)
6. [The prompt and LLM synthesis](#6-the-prompt-and-llm-synthesis)
7. [Evaluation framework and results](#7-evaluation-framework-and-results)
8. [Findings from the report](#8-findings-from-the-report)
9. [Limitations](#9-limitations)
10. [Where the report and the code disagree](#10-where-the-report-and-the-code-disagree)
11. [Reading guide](#11-reading-guide)

---

## 1. The problem this solves

The report's framing (§1, Abstract): traditional crime ML models predict *what* will
happen but can't explain *why*. An XGBoost model can tell you District 11 has a higher
arrest probability and SHAP can tell you `Crime Type (Narcotics)` contributed +0.18 to
that prediction — but it cannot tell you that Garfield Park has long-standing open-air
drug markets, that policing there is described in news coverage as aggressive and
tactical, or that citywide bail-reform debates are shaping enforcement posture.

So the project does something different: instead of predicting, it **retrieves evidence
and narrates**. Structured crime statistics get fused with unstructured news coverage,
and an LLM writes the explanation.

> **Core thesis (report §5.2):** "ML Model: High accuracy, limited actionability.
> Narrative System: Moderate accuracy, high interpretability + actionability."

---

## 2. The two datasets

### 2.1 Chicago crime records

| | |
|---|---|
| Source | Chicago Data Portal |
| Records | ~1.88M incidents (report: 1,883,142) |
| Period | 2018–2025 |
| Key fields | `Date`, `Primary Type`, `Block`, `Arrest`, `District`, `Ward`, `Latitude`, `Longitude` |

Preprocessing per report §2.3.1: null handling, datetime parsing (deriving Year/Month/
Day/Hour/Weekday), type coercion, duplicate removal on `Case Number`, geo-outlier
filtering (lat 41–42, lon −88 to −87), and feature engineering (Season, WeekendFlag,
CrimeCategory).

### 2.2 Chicago Tribune articles

| | |
|---|---|
| Source | ProQuest Archives |
| Articles | ~15,247 crime-related articles |
| Period | 2018–2025 |
| Fields | `Title`, `Full Text`, `Publication Date`, `Subject` |

### 2.3 The fundamental difficulty

**These two datasets share no join key.** No article carries a case number; no crime
record carries an article ID. And they differ in scale by two orders of magnitude —
1.88M incidents vs 15K articles.

The report calls this the **scale mismatch** (§4.3) and it drives two design decisions:
aggregate crimes into patterns rather than embedding individual incidents, and use
strict filters so only high-confidence links are produced.

---

## 3. Architecture: three tiers

Report §5.1 describes a **three-tier Hybrid RAG**:

```
         ┌──────────────── TIER 1: SEMANTIC RETRIEVAL ────────────────┐
         │  crime chunks ──embed──► crime_index.faiss                 │
         │  news chunks  ──embed──► news_index.faiss                  │
         │  query ──embed──► search both ──► top-k from each          │
         └────────────────────────────────────────────────────────────┘
         ┌──────────── TIER 2: DETERMINISTIC LINKING ─────────────────┐
         │  rule-based: ±3 day window + crime-type word               │
         │  + street-name word ──► crime_news_links.jsonl             │
         └────────────────────────────────────────────────────────────┘
         ┌──────────── TIER 3: LLM NARRATIVE SYNTHESIS ───────────────┐
         │  all three evidence types ──► prompt ──► Gemini ──► answer │
         └────────────────────────────────────────────────────────────┘
```

**Why both Tier 1 and Tier 2?** They fail in opposite directions — this is the single
most important design idea in the project. From report §4.3:

| Component | Strength | Limitation |
|---|---|---|
| Semantic search | Flexible, discovers unexpected connections | Can miss explicit relationships |
| Deterministic links | High precision, explainable | Brittle to wording variations |
| LLM synthesis | Handles diverse evidence, coherent narratives | Risk of hallucination |

Semantic search can surface a crime chunk and an article that are *topically* similar
but never asserts they describe the same event. The deterministic linker makes exactly
that assertion — same street, same crime type, within days — and the LLM is told to
treat those as confirmed cross-references.

---

## 4. Build phase, step by step

Everything in this section runs **once, offline**. The query path never re-does any of it.

Driver cell:

```python
system = NarrativeIntelligenceSystem(crime_df, news_df)

system.create_crime_chunks()
system.create_news_chunks()
system.build_crime_news_links(days_window=3)

system.build_vector_index(CRIME_CHUNKS_FILE, f"{CACHE_DIR}/crime_index.faiss")
system.build_vector_index(NEWS_CHUNKS_FILE,  f"{CACHE_DIR}/news_index.faiss")
```

### 4.1 Parsing the ProQuest exports

ProQuest `.txt` exports concatenate many articles, separated by lines of underscores,
each with labelled fields. The parser reverses that:

```python
def extract_field(block, field_name):
    """
    Extracts a metadata field like 'Title:' or 'Publication date:'.
    Rule:
    - Capture everything after "FieldName:"
    - Stop when we hit the next field label or the end of block
    """
    pattern = rf"{field_name}\s*:\s*(.*?)(?=\n[A-Za-z ]+\s*:|\Z)"
    match = re.search(pattern, block, flags=re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None


def parse_proquest_file(path):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    # Split articles by line of underscores
    blocks = re.split(r"_+\s*\n", text)

    articles = []
    for block in blocks:
        block = block.strip()
        if len(block) < 50:
            continue

        title   = extract_field(block, "Title")
        author  = extract_field(block, "Author")
        pubdate = extract_field(block, "Publication date")
        doctype = extract_field(block, "Document type")
        subject = extract_field(block, "Subject")
        fulltext = extract_field(block, "Full text")
        ...
```

The regex is doing real work. The lookahead `(?=\n[A-Za-z ]+\s*:|\Z)` is what allows
multi-line fields: `Full text:` runs for paragraphs, and capture stops only when a new
`Label:` line appears or the block ends. `re.DOTALL` lets `.` cross newlines.

Two fallbacks prevent silent data loss: no title → use the first line; no full text →
use the entire block.

### 4.2 Crime chunking

The key abstraction step. Instead of embedding 1.88M individual incidents (report:
"memory/computation prohibitive"), incidents are aggregated into **patterns**.

```python
def create_crime_chunks(self, min_crimes=5):
    g = self.crime_df.groupby(
        ["Primary Type", "Block", self.crime_df["Date"].dt.date]
    )

    for (ptype, block, day), grp in tqdm(g, total=len(g)):
        if len(grp) < min_crimes:
            continue

        text = f"""
Crime Report Summary
Type: {ptype}
Block: {block}
Date: {day}
Incidents: {len(grp)}
Arrests: {grp['Arrest'].sum()}
Latitude: {grp['Latitude'].mean()}
Longitude: {grp['Longitude'].mean()}
"""
        metadata = {
            "primary_type": ptype,
            "block": block,
            "date": str(day),
            "count": len(grp)
        }

        write_jsonl(CRIME_CHUNKS_FILE, {"text": text, "metadata": metadata})
```

Three things to notice:

1. **The grouping key is `(Primary Type, Block, calendar day)`.** One chunk = "all
   thefts on this block on this day."
2. **`min_crimes=5` is a hard filter.** A group with 4 incidents produces nothing. An
   isolated homicide is therefore *invisible to retrieval* — only clusters are
   searchable. This is a deliberate trade (find patterns, not incidents) but it's the
   single biggest constraint on what the system can answer.
3. **The chunk text is synthesized, not extracted.** There is no natural-language
   source text for a crime record — the pipeline *writes* a mini-report so that a
   sentence-embedding model has something meaningful to encode. The `Type:` and
   `Block:` labels are what let a query like "theft on Lincoln Ave" land near it in
   vector space.

### 4.3 News chunking

```python
def create_news_chunks(self, max_len=1500):
    for _, row in tqdm(self.news_df.iterrows(), total=len(self.news_df)):
        text = f"Title: {row['Title']}\n\n{row['FullText']}"
        metadata = {
            "title": str(row['Title']),
            "date": str(row["PublicationDate"]),
            "subject": str(row.get("Subject"))
        }

        write_jsonl(NEWS_CHUNKS_FILE, {
            "text": text[:max_len],
            "metadata": metadata
        })
```

**One article = one chunk.** There is no sliding-window or paragraph-level chunking —
unusual for RAG, and a real limitation: a 4,000-word investigative piece is represented
by a single vector built from its first 1,500 characters.

> ⚠️ **Subtlety worth knowing:** `all-MiniLM-L6-v2` has `max_seq_length = 256` tokens
> (≈1,000–1,100 characters). So the 1,500-character truncation is already *longer than
> the model can encode* — the tokenizer silently drops the tail. Effectively only about
> the first two-thirds of each truncated article is embedded.

### 4.4 Deterministic linking

```python
def build_crime_news_links(self, days_window=3):
    for _, crime in tqdm(self.crime_df.iterrows(), total=len(self.crime_df)):
        date  = crime["Date"]
        ptype = crime["Primary Type"]
        block = crime["Block"]

        # 1. TEMPORAL FILTER — articles within ±3 days
        window = self.news_df[
            (self.news_df["PublicationDate"] >= date - pd.Timedelta(days=days_window)) &
            (self.news_df["PublicationDate"] <= date + pd.Timedelta(days=days_window))
        ]

        # 2. LOCATION FILTER — article mentions the street name
        tokens = block.split()
        simple_block = tokens[2] if len(tokens) > 2 else (tokens[-1] if tokens else block)
        candidates = window[window["FullText"].str.contains(
            re.escape(simple_block), case=False, na=True)]

        # 3. KEYWORD FILTER — article mentions the crime type
        candidates = candidates[candidates["FullText"].str.contains(
            ptype.split()[0], case=False, na=True)]

        # 4. CREATE LINK
        for _, news in candidates.iterrows():
            write_jsonl(LINKS_FILE, {
                "crime_type":  ptype,
                "crime_block": block,
                "crime_date":  str(date),
                "news_title":  news["Title"],
                "news_date":   str(news["PublicationDate"])
            })
```

All three filters must pass. The block string format is `083XX S WHIPPLE ST` →
`[house-number, direction, street-name, suffix]`, so `tokens[2]` is the street name
(`WHIPPLE`), and `ptype.split()[0]` takes the first word of the crime type
(`CRIMINAL DAMAGE` → `CRIMINAL`).

**Complexity:** this is O(crimes × articles) — for every one of 1.88M crime rows it
runs a date filter plus two full-text scans over the article table. Report §6.1 measures
this at **49.3 minutes**, 83% of the entire ~59-minute build.

### 4.5 Embedding and FAISS indexing

```python
def build_vector_index(self, jsonl_file, output_index, batch_size=128):
    index = None
    texts = []

    # Streaming read
    with open(jsonl_file, "r", encoding="utf-8") as f:
        for line in tqdm(f):
            obj = json.loads(line)
            texts.append(obj["text"])

            if len(texts) >= batch_size:
                emb = self.model.encode(texts, convert_to_numpy=True, batch_size=16)
                if index is None:
                    index = faiss.IndexFlatL2(emb.shape[1])
                index.add(emb.astype("float32"))
                texts = []
                gc.collect()

    # Remaining
    if texts:
        emb = self.model.encode(texts, convert_to_numpy=True, batch_size=16)
        if index is None:
            index = faiss.IndexFlatL2(emb.shape[1])
        index.add(emb.astype("float32"))

    faiss.write_index(index, output_index)
```

#### 🔑 The invariant that makes the whole system work

**FAISS stores vectors and nothing else** — no text, no metadata, no IDs. It returns
integer positions.

This loop reads the JSONL top-to-bottom and calls `index.add()` in that same order.
Therefore:

> **FAISS vector position `i` ⟷ line `i` of the corresponding `.jsonl` file.**

That positional correspondence is the *only* mechanism connecting a search result back
to its text. If either file were ever rewritten without the other, retrieval would
silently return wrong documents with no error. Internalize this before reading
`rag_query`.

#### The embedding model

`all-MiniLM-L6-v2` (SentenceTransformers), per report §5.2:

- **384-dimensional** dense output
- 6-layer distilled MiniLM transformer
- Trained with contrastive learning on sentence pairs
- Module pipeline: `Transformer → Pooling → Normalize` — output vectors are
  **unit-normalized** (‖v‖ = 1)

#### Why `IndexFlatL2` is a fine choice here

`IndexFlatL2` is **exact brute-force** search — no approximation, no training step.
Every query compares against every stored vector: 15,299 × 384 ≈ 5.9M float operations,
roughly a millisecond. At this scale an approximate index (IVF, HNSW) would add
complexity for no gain. Report §6.3 notes ANN would matter at ~10× scale.

**L2 vs cosine:** because the embeddings are unit-normalized,

```
‖a − b‖² = ‖a‖² + ‖b‖² − 2·a·b = 2 − 2·cos(a, b)
```

L2 distance is a strictly decreasing function of cosine similarity, so **ranking by L2
is identical to ranking by cosine here.** The choice is safe — but *only* because of
that normalization.

---

## 5. What happens when a user enters a query

This is the runtime path. Every step below executes on every question.

### The entry point

```python
chat.ask("What crimes with arrests were reported near the N Lincoln Ave corridor?")
```

`NarrativeChatbot.ask()` immediately delegates retrieval:

```python
def ask(self, query):
    rag = self.system.rag_query(query)       # ← STEP 1-4 happen in here
    ...
```

### Step 1 — Embed the query

```python
q_emb = self.model.encode([user_query], convert_to_numpy=True)
```

The question string becomes a **(1, 384) float array** using the *same* model that
encoded every chunk at build time. This is mandatory — vectors from two different models
are not comparable, so the query embedder and the corpus embedder must match exactly.

Measured cost (report §6.2): **0.03 s**.

### Step 2 — Load the FAISS indices

```python
crime_index = faiss.read_index(f"{CACHE_DIR}/crime_index.faiss")
news_index  = faiss.read_index(f"{CACHE_DIR}/news_index.faiss")
```

⚠️ Note this happens **inside `rag_query`**, so both index files are re-read from disk
**on every single query** (218 MB + 32 MB in the report's run). Nothing is cached across
queries.

### Step 3 — Two parallel similarity searches

```python
d_c, i_c = crime_index.search(q_emb, top_k)   # top_k = 5
d_n, i_n = news_index.search(q_emb, top_k)
```

`search()` returns two arrays:
- `d_*` — **distances** (squared L2) to each neighbour, ascending
- `i_*` — **integer positions** of those neighbours

So `i_c[0]` might be `[312, 47, 288, 15, 401]` — the line numbers of the 5 most
semantically similar crime chunks.

The two indices are searched **independently**, each returning its own top-5. There's no
unified ranking across the two corpora and no re-ranking step; the split is always 5
crime + 5 news regardless of whether the question is about statistics or coverage.

Measured cost: **0.14 s** for both searches.

### Step 4 — Map positions back to text

This is the invariant from §4.5 being cashed in:

```python
def read_chunk(file, idx):
    with open(file, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f):
            if line_num == idx:
                return json.loads(line)

crime_chunks = [read_chunk(CRIME_CHUNKS_FILE, i) for i in i_c[0]]
news_chunks  = [read_chunk(NEWS_CHUNKS_FILE, i)  for i in i_n[0]]
```

`read_chunk` reopens the file and scans line-by-line from the beginning until it reaches
line `idx`. It's called **10 times** (5 crime + 5 news), so the files get re-scanned ten
times per query. Measured: **0.22 s**.

### Step 5 — Load deterministic links

```python
links = []
with open(LINKS_FILE, "r", encoding="utf-8") as f:
    for L in f:
        links.append(json.loads(L))

return {
    "crime": crime_chunks,
    "news":  news_chunks,
    "links": links[:20]
}
```

> 🚨 **This is the performance bottleneck of the entire query path.** It reads and
> JSON-parses the **complete** links file — all 68,423 records in the report's run —
> and then discards everything except the first 20 (`links[:20]`).
>
> Report §6.2 measures link loading at **30.11 s of the 32.6 s end-to-end latency** —
> about **92% of total query time** spent parsing records that are immediately thrown
> away.

There's a second consequence beyond speed: `links[:20]` takes the **first 20 lines of
the file**, which have no relationship to the question being asked. The links file is a
flat append-ordered log, so the "deterministic cross-references" handed to the LLM are
essentially arbitrary rather than relevant to the retrieved crime chunks.

### Step 6 — Assemble the context

Back in `NarrativeChatbot.ask()`:

```python
context = "\n\n".join([
    "=== CRIME DATA ===\n" + "\n".join(c["text"] for c in rag["crime"]),
    "=== NEWS DATA ===\n"  + "\n".join(n["text"] for n in rag["news"]),
    "=== LINKS FOUND ===\n" + "\n".join(json.dumps(l) for l in rag["links"])
])
```

Three clearly-delimited evidence sections. The section headers matter: they tell the
model which evidence is a statistic, which is journalism, and which is an asserted
cross-reference.

### Step 7 — Prompt and generate

```python
prompt = f"""
You are a Chicago crime-narrative analyst.

User question:
{query}

Use ALL crime + news + cross-links below to generate a unified narrative:

{context}

Return a structured, factual narrative insight combining both datasets.
"""

return self.model.generate_content(prompt).text
```

Measured: **2.1 s average** for the Gemini call.

### The complete timeline

| Stage | Latency | Share |
|---|---|---|
| Query embedding | 0.03 s | 0.1% |
| FAISS search (both indices) | 0.14 s | 0.4% |
| Chunk loading | 0.22 s | 0.7% |
| **Link loading** | **30.11 s** | **92.4%** |
| Retrieval subtotal | 30.50 s | |
| Gemini API call | 2.1 s | 6.4% |
| **End-to-end** | **32.6 s** | |

The headline takeaway: **the RAG retrieval itself is fast** (0.39 s for embedding +
search + chunk loading). Essentially all latency is one inefficient file read.

---

## 6. The prompt and LLM synthesis

The report (§5.2, pages 10–11) documents a fuller prompt template than the notebook's
current one, with numbered instructions:

```
INSTRUCTIONS:
1. Synthesize information from ALL three sections
2. Explain both statistical patterns AND contextual factors
3. Connect crime incidents with relevant news coverage
4. Provide temporal and spatial insights
5. Use clear, factual language avoiding speculation
6. If data is insufficient, acknowledge limitations
```

Instruction 5 ("avoiding speculation") and 6 ("acknowledge limitations") are the
hallucination guards — the only ones in the system, since nothing programmatically
verifies the output against the retrieved evidence at generation time.

The intended output combines:
- Quantitative patterns (incident counts, arrest rates)
- Spatial analysis (geographic concentration)
- Temporal dynamics (seasonal/weekly/hourly)
- Contextual factors (news-reported events, community concerns)
- Explanatory hypotheses (*why* patterns exist)

That last category is what no ML model in the project produces.

**Model:** Google Gemini via `google.generativeai`.

**Important architectural note:** the system is **single-shot and stateless**. There's no
query rewriting, no multi-hop retrieval, no re-ranking, no conversation memory, and no
agentic loop. One question → one retrieval → one generation.

---

## 7. Evaluation framework and results

Implemented as the `RAGEvaluator` class, which scores retrieval and generation
separately.

### 7.1 Retrieval metrics

```python
def evaluate_retrieval_diversity(self, query: str, top_k=5) -> Dict:
    """Measure diversity of retrieved documents."""
    rag_results = self.system.rag_query(query, top_k=top_k)

    crime_types = []
    for crime_doc in rag_results['crime']:
        match = re.search(r'Type:\s*(.+)', crime_doc['text'])
        if match:
            crime_types.append(match.group(1).strip())
    ...
    metrics = {
        'unique_crime_types': len(set(crime_types)),
        'crime_diversity_ratio': len(set(crime_types)) / len(crime_types) if crime_types else 0,
        'unique_news_articles': len(set(news_titles)),
        'news_diversity_ratio': len(set(news_titles)) / len(news_titles) if news_titles else 0
    }
```

Note the metrics parse values back out of the generated chunk text with regex
(`r'Type:\s*(.+)'`) — which works precisely *because* `create_crime_chunks` wrote that
text in a fixed labelled format.

Also measured: `evaluate_retrieval_coverage` (unique dates, unique blocks — temporal and
spatial spread).

### 7.2 Faithfulness — the most important metric

```python
def evaluate_faithfulness(self, answer: str, rag_results: Dict) -> Dict:
    """Check if answer statements are supported by retrieved documents."""
    all_context = []
    for crime_doc in rag_results['crime']:
        all_context.append(crime_doc['text'].lower())
    for news_doc in rag_results['news']:
        all_context.append(news_doc['text'].lower())
    combined_context = ' '.join(all_context)

    # Split answer into claims (sentences)
    claims = [s.strip() for s in answer.split('.') if s.strip() and len(s.strip()) > 10]

    supported_claims = 0
    for claim in claims:
        claim_words = [w.lower() for w in claim.split() if len(w) > 4 and w.isalpha()]
        if claim_words:
            # Check if at least 30% of key words appear in context
            matches = sum(1 for word in claim_words if word in combined_context)
            if matches / len(claim_words) >= 0.3:
                supported_claims += 1

    metrics = {
        'total_claims': len(claims),
        'supported_claims': supported_claims,
        'faithfulness_score': round(supported_claims / len(claims), 4) if claims else 0,
        'unsupported_claims': len(claims) - supported_claims,
    }
```

This is a **lexical-overlap proxy for grounding**, not true entailment checking. A
sentence counts as "supported" if ≥30% of its words longer than 4 characters appear
anywhere in the retrieved context. Be ready to defend this: it can't detect a claim that
reuses context vocabulary but asserts a false relationship (e.g. inventing a causal link
between two things that both appear in the context). It's a reasonable cheap heuristic,
not a rigorous factuality metric.

### 7.3 Results (report §6.2–6.4)

**Retrieval:**
- 6–10 documents retrieved per query, **average 8.7**
- **News diversity: 100%** — every retrieved article unique
- Temporal/spatial coverage: typically 3–5 unique dates, multiple blocks
- ⚠️ **Crime-type diversity only ~20–30%** — retrieval collapses onto one dominant
  crime category per query

**Generation:**
- Average answer length: **380 words**
- 5–9 statistical facts per answer
- Context utilization: **45–59%**
- Faithfulness: **75–100%** (best case: zero unsupported claims)

**Aggregates:**

| Metric | Value |
|---|---|
| Average documents retrieved | 8.7 |
| Average faithfulness | 78.3% |
| Average context utilization | 52.5% |
| Average answer length | 380 words |

### 7.4 Baseline comparison (report §6.5)

| Baseline | Result |
|---|---|
| Keyword search | Low precision *and* recall |
| Embeddings-only | Missed many deterministic crime–news connections |
| Zero-shot LLM (no retrieval) | **~65% hallucination rate** |
| **Hybrid RAG (this system)** | **~54% precision gain, ~80% hallucination reduction** |

The embeddings-only row is the empirical justification for Tier 2 existing at all.

---

## 8. Findings from the report

### 8.1 Media bias is measurable

Linkage rate by crime type (§5.2) — the share of incidents that got any news coverage:

| Crime type | Linkage rate |
|---|---|
| Homicide | **18.2%** |
| Robbery | 7.8% |
| Assault | 6.4% |
| Theft | 2.1% |
| Criminal Damage | **1.8%** |

> **Report's conclusion:** "Violent crimes 5–10× more likely to appear in news,
> confirming media bias toward sensational incidents."

Overall linkage rate: **4.5%** (~68,423 links). This is a genuine research finding that
emerged *from* the pipeline rather than being assumed by it.

### 8.2 Enforcement patterns ≠ crime prevalence

From the EDA (§2.4). Overall arrest rate is **15.6%**, but by type:

| Crime type | Arrest rate |
|---|---|
| Gambling | ~98% |
| Narcotics | ~95% |
| Prostitution | ~92% |
| Liquor Law Violation | ~88% |
| Weapons Violation | ~65% |
| Theft | ~14% |
| Criminal Damage | ~12% |

> **Report's interpretation:** "High arrest rates for 'vice' crimes reflect **targeted
> enforcement rather than crime prevalence**."

This is the interpretive move the whole project is built to enable — a near-100% arrest
rate means police *chose* to go looking, not that those crimes are more solvable.

### 8.3 Temporal patterns

- **Seasonal:** summer peak (~180K/month Jun–Aug) vs winter trough (~135K/month Dec–Feb)
- **Weekly:** Friday/Saturday highest (~280K each)
- **Hourly:** bimodal — peaks at noon (~110K) and midnight (~120K); minimum 4–6 AM (~35K)
- **Yearly:** 2020–21 dip (~205K, lockdowns), 2023–24 peak (~260K)

### 8.4 Crime type distribution

Theft 21.1% · Battery 19.4% · Criminal Damage 11.9% · Assault 9.5% · Deceptive Practice
8.3% · Motor Vehicle Theft 7.6% · Other Offense 7.2% · Burglary 4.8% · Robbery 4.6% ·
Narcotics 4.2%

### 8.5 Build and scale characteristics

| Phase | Duration | Peak memory |
|---|---|---|
| Crime data loading | 1.8 min | 2.4 GB |
| News parsing | 0.6 min | 0.8 GB |
| Crime chunking | 2.2 min | 1.5 GB |
| News chunking | 0.3 min | 0.4 GB |
| Embedding generation | 4.1 min | 2.8 GB |
| FAISS indexing | 0.5 min | 1.2 GB |
| **Link creation** | **49.3 min** | 2.1 GB |
| **Total** | **~59 min** | 2.8 GB peak |

Storage: 157K vectors × 384 dims × 4 bytes = **242 MB** of embeddings.

---

## 9. Limitations

### 9.1 Data quality (report §7)

- **Underreporting** in communities with low police trust
- **Media bias** — Tribune over-covers violent crime, under-covers property crime
- **Temporal misalignment** — articles may publish days after the incident, so a ±3-day
  window is a guess at the reporting lag

### 9.2 Semantic search

- **Query–document mismatch** — natural-language questions vs formal crime-report phrasing
- **Synonym problem** — "robbery" vs "mugging" embed differently
- **No temporal awareness** — embeddings don't know "recent"; nothing prioritizes newer
  events without explicit filtering

### 9.3 Deterministic linking

- **Keyword brittleness** — misspellings/alternate phrasings break matches
- **Street-name variation** — "Lincoln Ave" vs "Lincoln Avenue" vs "N Lincoln" all differ
- **False positives** — "shooting" in a sports article creates a bogus link

Two more that are visible in the code itself:

- **Common-word street names.** Chicago has streets named State, Michigan, Washington,
  Lake, Central, Western — and `Chicago` itself appears in the overwhelming majority of
  *Chicago* Tribune articles. Any crime on those streets matches the location filter
  almost unconditionally. `MAY ST` matches the month "May".
- **It's substring matching, not entity resolution.** No geocoding, no NER, no
  coordinate proximity — despite `Latitude`/`Longitude` being available in the chunk text.

### 9.4 LLM generation

- **Hallucination risk** — may infer causality the data doesn't support
- **Context window** — very long retrievals can exceed token limits
- **Consistency** — rephrasing the same question can yield different narratives

### 9.5 Architectural

- **Crime retrieval is sparse by construction** — the `min_crimes=5` filter means
  isolated incidents are unreachable
- **One vector per article**, capped at 256 tokens of encoded text
- **Fixed 5/5 retrieval split**, no re-ranking, no query classification
- **Links are query-independent** (`links[:20]` — see §5 Step 5)

### 9.6 Ethical framing (report §7)

The report explicitly addresses predictive-policing risk: models "intentionally avoid
neighborhood-level predictions to reduce stigmatization," relying on narrative context
to surface when disparities may reflect **bias rather than true crime levels**. The
District 11 vs District 6 worked example in §5.1 deliberately presents both the
"legitimate enforcement" and "systemic bias" readings of the same statistics.

---

## 10. Where the report and the code disagree

Worth knowing before you present this — someone may ask.

### 10.1 Crime chunk count: 142,635 vs ~508

The report (§5.2) states **~142,635 crime chunks** ("142K chunks vs 1.8M incidents = 92%
reduction"), with a 218 MB crime index. That's internally consistent
(142,635 × 384 × 4 bytes ≈ 219 MB).

But the notebook's `create_crime_chunks` groups by **raw `Block`** —
`groupby(["Primary Type", "Block", Date.dt.date])` with `min_crimes=5`. Running that
over the full 1.92M-row CSV yields **1,871,569 groups, of which only 508 have ≥5
incidents.** Nearly every (type, block, day) combination is a single incident.

The likely explanation is in report §2.3.1, which describes **Block Normalization**:

> "Normalization extracts the core street name ('LOWE AVE') to enable matching with news
> articles..."

Grouping by *normalized street* (all of `070XX S LOWE AVE`, `071XX S LOWE AVE`, … →
`LOWE AVE`) makes groups far larger and would plausibly produce ~142K qualifying groups.
**The notebook code as written does not apply that normalization in the chunking step.**

So: the report describes normalized-block chunking; the current chunking code uses raw
blocks. If you're asked why your index is small, this is why.

### 10.2 Link count: 68,423 vs ~33,010

The report cites **~68,423 links (4.5% linkage rate)**. Re-running the corrected pipeline
over the full dataset produces **33,010**. Expected, given §10.1 — different block
handling changes both what's chunked and what matches the location filter.

### 10.3 A silent date-parsing bug

```python
self.news_df["PublicationDate"] = pd.to_datetime(
    self.news_df["PublicationDateRaw"], errors="coerce"
)
```

Under pandas 3.x this silently fails on most rows. pandas infers a single datetime format
from the first value and coerces everything not matching it to `NaT` — even though all
the ProQuest dates share the same `"Mon D, YYYY"` shape. Measured on this corpus: only
**1,261 of 14,990** dates parsed; the other ~92% became `NaT`.

Because the linking step's first filter is a date-window comparison, and `NaT` compares
`False` against everything, **~92% of articles were silently ineligible for linking.**
The fix is `format="mixed"`.

If your environment ran an older pandas, this may not have affected the original results
— but it's worth knowing the failure mode is *silent*, with no warning and no error.

---

## 11. Reading guide

Read the notebook in this order:

| # | What | Why |
|---|---|---|
| 1 | `NarrativeIntelligenceSystem.__init__` | See what state the system holds |
| 2 | `create_crime_chunks` | **Start here conceptually** — defines what is retrievable at all |
| 3 | `create_news_chunks` | The simpler counterpart |
| 4 | `build_vector_index` | Internalize the JSONL-order ↔ FAISS-position invariant |
| 5 | `rag_query` | The actual retrieval path |
| 6 | `NarrativeChatbot.ask` | Context assembly + prompt |
| 7 | `build_crime_news_links` | The rule-based tier |
| 8 | `RAGEvaluator` | How claims about quality were measured |

### The classes

| Class | Holds | Key methods |
|---|---|---|
| `NarrativeIntelligenceSystem` | `crime_df`, `news_df`, the SentenceTransformer model | `create_crime_chunks`, `create_news_chunks`, `build_crime_news_links`, `build_vector_index`, `rag_query` |
| `NarrativeChatbot` | Gemini client + a reference to the system | `ask` |
| `RAGEvaluator` | References to both of the above | `evaluate_retrieval_quality`, `evaluate_retrieval_diversity`, `evaluate_retrieval_coverage`, `evaluate_answer_quality`, `evaluate_context_utilization`, `evaluate_faithfulness`, `comprehensive_evaluation` |

Relationships are **composition, not inheritance**: the chatbot *has a* system; the
evaluator *has both*.

### The five build artifacts

| File | What it is |
|---|---|
| `cache/crime_chunks.jsonl` | One line per crime pattern: `{text, metadata}` |
| `cache/news_chunks.jsonl` | One line per article: `{text, metadata}` |
| `cache/crime_news_links.jsonl` | Flat log of rule-matched crime↔news pairs |
| `cache/crime_index.faiss` | Crime vectors, aligned to `crime_chunks.jsonl` line order |
| `cache/news_index.faiss` | News vectors, aligned to `news_chunks.jsonl` line order |

---

## One-paragraph summary

Two datasets with no shared key — 1.88M structured crime records and 15K unstructured
news articles — are each reduced to text chunks and embedded into 384-dimensional
vectors with `all-MiniLM-L6-v2`, then stored in two separate exact-search FAISS indices.
In parallel, a rule-based engine cross-links individual crimes to articles that mention
the same street and crime type within ±3 days, producing high-precision but brittle
connections that semantic search alone would miss. At query time the user's question is
embedded with the same model, both indices are searched for their top-5 nearest
neighbours, the resulting positions are mapped back to their source text via strict
line-order correspondence, and the crime chunks, news chunks, and deterministic links are
assembled into three labelled sections of a single prompt. Google Gemini then synthesizes
a narrative that fuses the statistical patterns with the journalistic context — producing
the *explanation* that an accuracy-optimized classifier fundamentally cannot.
