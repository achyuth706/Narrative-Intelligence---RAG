"""Serving-side RAG system: loads pre-built chunk/index caches produced by
the NarrativeIntelligenceSystem pipeline (see the notebook / build_index.py)
and answers queries against them. Building the cache is a separate, offline
step — this module never re-embeds the raw crime/news data itself.
"""
import json
import logging
import os
import threading
from collections import OrderedDict, defaultdict

import faiss
import google.generativeai as genai
from google.api_core import exceptions as google_errors
from sentence_transformers import SentenceTransformer

log = logging.getLogger("ccni")

# Tried in order. Gemini free-tier quotas are tracked per model, so when the
# primary model's quota runs out the next one still has its own allowance.
# Each of these was verified to respond on this project's key; the 2.5-series
# models are still *listed* but return 404 for new users, so they're excluded.
FALLBACK_MODELS = [
    "models/gemini-flash-latest",
    "models/gemini-3.5-flash-lite",
    "models/gemini-3.1-flash-lite",
    "models/gemini-flash-lite-latest",
]


class GenerationBlocked(RuntimeError):
    """Gemini returned no usable text, typically a safety-filter block."""

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.environ.get("CACHE_DIR") or os.path.join(BASE_DIR, "cache")

CRIME_CHUNKS_FILE = os.path.join(CACHE_DIR, "crime_chunks.jsonl")
NEWS_CHUNKS_FILE = os.path.join(CACHE_DIR, "news_chunks.jsonl")
LINKS_FILE = os.path.join(CACHE_DIR, "crime_news_links.jsonl")
CRIME_INDEX_FILE = os.path.join(CACHE_DIR, "crime_index.faiss")
NEWS_INDEX_FILE = os.path.join(CACHE_DIR, "news_index.faiss")


def _load_jsonl(path, limit=None):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
            if limit and len(rows) >= limit:
                break
    return rows


class NarrativeRAGSystem:
    """Retrieval side: embeds a query and searches the crime + news FAISS
    indices built by the offline pipeline."""

    def __init__(self, embedding_model="all-MiniLM-L6-v2", max_links_per_query=20):
        missing = [
            p
            for p in [CRIME_CHUNKS_FILE, NEWS_CHUNKS_FILE, LINKS_FILE, CRIME_INDEX_FILE, NEWS_INDEX_FILE]
            if not os.path.exists(p)
        ]
        if missing:
            raise FileNotFoundError(
                "Missing cache files: "
                + ", ".join(missing)
                + ". Run the pipeline (notebook or build_index.py) first to build cache/."
            )

        self.max_links_per_query = max_links_per_query
        self.model = SentenceTransformer(embedding_model)
        self.crime_chunks = _load_jsonl(CRIME_CHUNKS_FILE)
        self.news_chunks = _load_jsonl(NEWS_CHUNKS_FILE)
        # Indexed by the same (type, block, day) key a crime chunk's metadata
        # carries, so a query's actual retrieved crime chunks -- not just
        # "the first N lines of the file" -- determine which links are shown.
        self.links_by_key = defaultdict(list)
        self.total_links = 0
        for link in _load_jsonl(LINKS_FILE):
            key = (link["crime_type"], link["crime_block"], link["crime_date"][:10])
            self.links_by_key[key].append(link)
            self.total_links += 1
        self.crime_index = faiss.read_index(CRIME_INDEX_FILE)
        self.news_index = faiss.read_index(NEWS_INDEX_FILE)
        self._analytics = self._compute_analytics()

    def stats(self):
        return {
            "crime_chunks": len(self.crime_chunks),
            "news_chunks": len(self.news_chunks),
            "links": self.total_links,
        }

    def analytics(self):
        return self._analytics

    def _compute_analytics(self):
        type_counts = defaultdict(int)
        block_counts = defaultdict(int)
        dates = []
        for c in self.crime_chunks:
            meta = c.get("metadata", {})
            n = int(meta.get("count", 0) or 0)
            if meta.get("primary_type"):
                type_counts[meta["primary_type"]] += n
            if meta.get("block"):
                block_counts[meta["block"]] += n
            if meta.get("date"):
                dates.append(meta["date"])

        subject_counts = defaultdict(int)
        for n in self.news_chunks:
            meta = n.get("metadata", {})
            for raw in (meta.get("subject") or "").split(";"):
                s = raw.strip()
                if s and s.lower() not in ("nan", "none"):
                    subject_counts[s] += 1

        def top(d, n=8):
            return [{"label": k, "value": v} for k, v in sorted(d.items(), key=lambda kv: -kv[1])[:n]]

        return {
            "top_crime_types": top(type_counts),
            "top_blocks": top(block_counts),
            "top_news_subjects": top(subject_counts),
            "date_range": {"start": min(dates), "end": max(dates)} if dates else None,
            "total_links": self.total_links,
        }

    def rag_query(self, query, top_k=5):
        q_emb = self.model.encode([query], convert_to_numpy=True).astype("float32")

        k_c = min(top_k, self.crime_index.ntotal)
        k_n = min(top_k, self.news_index.ntotal)
        _, i_c = self.crime_index.search(q_emb, k_c) if k_c else (None, [[]])
        _, i_n = self.news_index.search(q_emb, k_n) if k_n else (None, [[]])

        crime_hits = [self.crime_chunks[i] for i in i_c[0] if 0 <= i < len(self.crime_chunks)]
        news_hits = [self.news_chunks[i] for i in i_n[0] if 0 <= i < len(self.news_chunks)]

        # Only links tied to the crime chunks actually retrieved for this
        # query -- not an arbitrary slice of the links file.
        seen = set()
        relevant_links = []
        for c in crime_hits:
            meta = c.get("metadata", {})
            key = (meta.get("primary_type"), meta.get("block"), meta.get("date"))
            for link in self.links_by_key.get(key, []):
                ident = (link["news_title"], link["crime_date"])
                if ident in seen:
                    continue
                seen.add(ident)
                relevant_links.append(link)
                if len(relevant_links) >= self.max_links_per_query:
                    break
            if len(relevant_links) >= self.max_links_per_query:
                break

        return {
            "crime": crime_hits,
            "news": news_hits,
            "links": relevant_links,
        }


class NarrativeChatbot:
    """Generation side: stuffs retrieved chunks into a prompt and asks
    Gemini to synthesize a narrative answer."""

    def __init__(self, api_key, system: NarrativeRAGSystem, model_names=None, cache_size=256):
        genai.configure(api_key=api_key)
        self.model_names = list(model_names or FALLBACK_MODELS)
        self.models = {name: genai.GenerativeModel(name) for name in self.model_names}
        self.system = system
        # Visitors mostly click the same example prompts; answering repeats
        # from memory keeps them from spending the small daily quota.
        self.cache_size = cache_size
        self._cache = OrderedDict()
        self._cache_lock = threading.Lock()

    def _generate(self, prompt):
        last_error = None
        for name in self.model_names:
            try:
                response = self.models[name].generate_content(prompt)
            except (google_errors.ResourceExhausted, google_errors.NotFound) as e:
                # this model is out of quota or unavailable; the next has its own allowance
                log.warning("Gemini model %s unavailable (%s), trying next", name, type(e).__name__)
                last_error = e
                continue
            try:
                text = response.text
            except ValueError:
                # .text raises when no candidate part came back (e.g. safety block)
                raise GenerationBlocked(f"{name} returned no text (likely blocked by safety filters)")
            log.info("answered with %s", name)
            return text
        raise last_error

    def ask(self, query, top_k=5):
        key = (" ".join(query.lower().split()), top_k)
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]

        rag = self.system.rag_query(query, top_k=top_k)

        context = "\n\n".join(
            [
                "=== CRIME DATA ===\n" + "\n".join(c["text"] for c in rag["crime"]),
                "=== NEWS DATA ===\n" + "\n".join(n["text"] for n in rag["news"]),
                "=== LINKS FOUND ===\n" + "\n".join(json.dumps(link) for link in rag["links"]),
            ]
        )

        prompt = f"""You are a Chicago crime-narrative analyst.

User question:
{query}

Use ALL crime + news + cross-links below to generate a unified narrative:

{context}

Return a structured, factual narrative insight combining both datasets.

Formatting rules:
- Respond in GitHub-Flavored Markdown.
- For tabular data use real Markdown pipe tables (| Col | Col |) with a
  header separator row. Never draw tables with ASCII art (+---+---+ or
  box-drawing characters), and never wrap a table in a code fence.
- Keep tables narrow: at most 4 columns, short cell values, no line breaks
  inside a cell.
- Use code fences only for actual code."""

        result = (self._generate(prompt), rag)
        with self._cache_lock:
            self._cache[key] = result
            self._cache.move_to_end(key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return result
