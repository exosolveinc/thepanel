"""Supabase pgvector store for doc chunks.

Public coroutines:
  store_doc_chunks(doc_id, filename, text)   — semantic-chunk → embed → insert (idempotent)
  retrieve_relevant_chunks(question)         — embed query → global similarity search → text
  list_stored_docs()                         — list distinct docs in Supabase
  delete_doc_chunks(doc_id)                  — remove all chunks for a doc
  get_docs_context_for_shortcuts()           — sample of all doc text for shortcut generation
"""
import re
from supabase import create_client, Client
from services.embeddings import aembed
from config import settings

# ── Semantic chunking ────────────────────────────────────────────────

TARGET_WORDS = 200   # ideal words per chunk (~1500 chars)
MIN_WORDS    = 15    # discard chunks smaller than this


def _semantic_chunk(text: str) -> list[str]:
    """Split at paragraph/sentence boundaries instead of fixed character windows."""
    text = re.sub(r'\r\n', '\n', text)
    paragraphs = [p.strip() for p in re.split(r'\n{2,}', text) if p.strip()]

    chunks: list[str] = []
    buf: list[str] = []
    buf_words = 0

    for para in paragraphs:
        pw = len(para.split())

        # Very long single paragraph → split by sentences first
        if pw > TARGET_WORDS * 2:
            if buf:
                chunks.append('\n\n'.join(buf))
                buf, buf_words = [], 0
            sentences = re.split(r'(?<=[.!?])\s+', para)
            sbuf: list[str] = []
            sw = 0
            for sent in sentences:
                ssw = len(sent.split())
                if sw + ssw > TARGET_WORDS and sbuf:
                    chunks.append(' '.join(sbuf))
                    sbuf, sw = [sent], ssw
                else:
                    sbuf.append(sent)
                    sw += ssw
            if sbuf:
                buf = [' '.join(sbuf)]
                buf_words = sw
            continue

        # Flush buffer if adding this paragraph would overshoot target
        if buf_words + pw > TARGET_WORDS * 1.5 and buf:
            chunks.append('\n\n'.join(buf))
            buf, buf_words = [], 0

        buf.append(para)
        buf_words += pw

    if buf:
        chunks.append('\n\n'.join(buf))

    return [c for c in chunks if len(c.split()) >= MIN_WORDS]


# ── Supabase client (lazy singleton) ─────────────────────────────────

_client: Client | None = None


def _sb() -> Client | None:
    global _client
    if _client is not None:
        return _client
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client


# ── Store ────────────────────────────────────────────────────────────

async def store_doc_chunks(doc_id: str, filename: str, text: str) -> int:
    """Semantic-chunk, embed, and insert into Supabase. Idempotent by doc_id.
    Returns number of chunks stored (0 if already existed).
    """
    sb = _sb()
    if sb is None:
        return 0
    existing = sb.table("doc_chunks").select("id").eq("doc_id", doc_id).limit(1).execute()
    if existing.data:
        return 0

    chunks = _semantic_chunk(text)
    rows = []
    for i, chunk in enumerate(chunks):
        vec = await aembed(chunk)
        rows.append({
            "doc_id":      doc_id,
            "filename":    filename,
            "chunk_index": i,
            "chunk_text":  chunk,
            "embedding":   vec,
        })

    if rows:
        sb.table("doc_chunks").insert(rows).execute()
    return len(rows)


# ── Retrieve (global — no doc_id filter) ────────────────────────────

async def retrieve_relevant_chunks(question: str, top_k: int = 6) -> str:
    """Embed the question, similarity-search ALL docs in Supabase, return top-K chunks."""
    sb = _sb()
    if sb is None:
        return ""
    q_vec = await aembed(question)

    result = sb.rpc(
        "match_doc_chunks_global",
        {"query_embedding": q_vec, "match_count": top_k},
    ).execute()

    if not result.data:
        return ""

    return "\n\n---\n\n".join(r["chunk_text"] for r in result.data)


# ── List / Delete ────────────────────────────────────────────────────

def list_stored_docs() -> list[dict]:
    """Return one metadata row per distinct doc (uses chunk_index=0)."""
    sb = _sb()
    if sb is None:
        return []
    result = (
        sb.table("doc_chunks")
        .select("doc_id, filename, created_at")
        .eq("chunk_index", 0)
        .order("created_at", desc=True)
        .execute()
    )
    return [
        {"doc_id": r["doc_id"], "filename": r["filename"], "created_at": r["created_at"]}
        for r in result.data
    ]


def delete_doc_chunks(doc_id: str) -> None:
    """Remove all chunks for this doc_id from Supabase."""
    sb = _sb()
    if sb is None:
        return
    sb.table("doc_chunks").delete().eq("doc_id", doc_id).execute()


# ── Shortcuts context ────────────────────────────────────────────────

def get_docs_context_for_shortcuts(max_chars: int = 8000) -> str:
    """Return a representative sample of stored doc content for shortcut generation."""
    sb = _sb()
    if sb is None:
        return "No project documents stored."
    result = (
        sb.table("doc_chunks")
        .select("doc_id, filename, chunk_text, chunk_index")
        .order("doc_id")
        .order("chunk_index")
        .execute()
    )
    if not result.data:
        return "No project documents stored."

    seen: dict[str, int] = {}
    parts: list[str] = []
    total = 0
    for row in result.data:
        did = row["doc_id"]
        if did not in seen:
            seen[did] = 0
            parts.append(f"=== {row['filename']} ===")
        if seen[did] < 4:   # first 4 chunks per doc
            parts.append(row["chunk_text"])
            total += len(row["chunk_text"])
            seen[did] += 1
        if total >= max_chars:
            break

    return "\n\n".join(parts)
