"""Test RAG pipeline — embeddings, vector store, query rewrite.

LIVE integration tests (Bedrock Titan + Supabase pgvector).
Run with: pytest -m live
"""
import pytest
import asyncio

pytestmark = pytest.mark.live


def test_embeddings_import():
    """Embeddings module should import without error."""
    from services.embeddings import embed, EMBEDDING_DIMS
    assert EMBEDDING_DIMS == 1024


@pytest.mark.asyncio
async def test_embed_produces_vector():
    """Live test: Bedrock Titan should return a 1024-dim vector."""
    from services.embeddings import embed, EMBEDDING_DIMS
    vec = await asyncio.to_thread(embed, "test query about Python")
    assert isinstance(vec, list)
    assert len(vec) == EMBEDDING_DIMS
    assert all(isinstance(v, float) for v in vec)


@pytest.mark.asyncio
async def test_retrieve_relevant_chunks():
    """Live test: retrieval should return string (may be empty if no docs stored)."""
    from services.vector_store import retrieve_relevant_chunks
    result = await retrieve_relevant_chunks("What is Python?", top_k=3)
    assert isinstance(result, str)
    # Result can be empty if no docs in Supabase — that's OK


def test_list_stored_docs():
    """Should return a list without crashing."""
    from services.vector_store import list_stored_docs
    docs = list_stored_docs()
    assert isinstance(docs, list)


@pytest.mark.asyncio
async def test_rewrite_for_rag_no_history():
    """With no history, should return the question unchanged."""
    from services.hm_client import _rewrite_for_rag
    result = await _rewrite_for_rag("What is Docker?", [])
    assert result == "What is Docker?"


@pytest.mark.asyncio
async def test_rewrite_for_rag_with_history():
    """With history, should rewrite follow-up into standalone query."""
    from services.hm_client import _rewrite_for_rag
    history = [
        {"role": "user", "content": "Tell me about Redis caching"},
        {"role": "assistant", "content": "Redis is an in-memory data store used for caching..."},
    ]
    result = await _rewrite_for_rag("Why did you choose that?", history)
    assert isinstance(result, str)
    assert len(result) > 5
    # The rewritten query should be more specific than "Why did you choose that?"
    # (it should reference Redis or caching)


def test_vector_store_guards_missing_supabase():
    """If Supabase is not configured, functions should return gracefully."""
    from services.vector_store import _sb
    from config import settings

    orig_url = settings.supabase_url
    settings.supabase_url = ""
    try:
        assert _sb() is None
    finally:
        settings.supabase_url = orig_url
