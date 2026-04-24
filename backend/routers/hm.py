"""Hiring Manager mode endpoints — global doc store + 3-section SSE answer stream."""
import asyncio
import hashlib

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import AskRequest, SessionRequest
from services.session_store import get_session, append_history
from services.pdf_parser import aextract_text_from_pdf
from services.hm_client import stream_hm_answer, generate_shortcuts
from services.vector_store import store_doc_chunks, list_stored_docs, delete_doc_chunks
from utils.sse import sse_event, sse_error, sse_done, stream_with_cleanup
from utils.logging import get_logger

router = APIRouter(prefix="/api/hm", tags=["hiring-manager"])
logger = get_logger(__name__)

MAX_DOC_SIZE = 10 * 1024 * 1024   # 10 MB
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


# ── HM answer stream (3-section parallel) ────────────────────────────

async def _hm_ask_generator(request: AskRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found. Please restart.")
        return

    question = request.question.strip()
    if not question:
        yield sse_error("Question cannot be empty.")
        return

    overview = ""
    async for tok, section in stream_hm_answer(session, question):
        if tok is None:  # done sentinel
            break
        if section == "overview":
            overview += tok
        yield sse_event("token", {"text": tok, "section": section})
        await asyncio.sleep(0)

    if overview:
        append_history(session, "user", question)
        append_history(session, "assistant", overview)
    yield sse_done()


@router.post("/ask")
async def hm_ask(request: AskRequest):
    return StreamingResponse(
        stream_with_cleanup(_hm_ask_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/shortcuts")
async def hm_shortcuts(request: SessionRequest):
    """Generate context-aware quick-ask shortcuts from the session's documents."""
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please restart.")
    shortcuts = await generate_shortcuts(session)
    return {"shortcuts": shortcuts}


# ── Global project doc store (Supabase, no session required) ─────────

@router.post("/docs/upload")
async def upload_global_doc(file: UploadFile = File(...)):
    """Upload a PDF to the global Supabase doc store. Idempotent by content hash."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    content = await file.read()
    if len(content) > MAX_DOC_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10 MB.")

    try:
        text = await aextract_text_from_pdf(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    doc_id = hashlib.sha256(content).hexdigest()[:16]
    chunk_count = await store_doc_chunks(doc_id, file.filename, text)
    return {
        "doc_id":     doc_id,
        "filename":   file.filename,
        "char_count": len(text),
        "chunks":     chunk_count,
        "existed":    chunk_count == 0,
    }


@router.get("/docs/list")
async def list_global_docs():
    """List all docs in the global Supabase store."""
    return {"docs": list_stored_docs()}


@router.delete("/docs/{doc_id}")
async def delete_global_doc(doc_id: str):
    """Remove a doc from the global Supabase store."""
    delete_doc_chunks(doc_id)
    return {"ok": True}
