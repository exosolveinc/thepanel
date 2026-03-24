"""Hiring Manager mode endpoints — project doc upload + SSE answer stream."""
import json
import asyncio
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import AskRequest, SessionRequest
from services.session_store import get_session, append_history
from services.pdf_parser import extract_text_from_pdf
from services.hm_client import stream_hm_answer, generate_shortcuts

router = APIRouter(prefix="/api/hm", tags=["hiring-manager"])

MAX_DOC_SIZE  = 10 * 1024 * 1024   # 10 MB
MAX_DOC_COUNT = 5


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


@router.post("/upload-doc")
async def upload_hm_doc(
    session_id: str = Form(...),
    file: UploadFile = File(...),
):
    """Upload a project PDF and attach its text to the session."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please restart.")

    if len(session.project_docs) >= MAX_DOC_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_DOC_COUNT} project documents allowed per session.",
        )

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    content = await file.read()
    if len(content) > MAX_DOC_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10 MB.")

    try:
        text = extract_text_from_pdf(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    session.project_docs.append(text)

    return {
        "name": file.filename,
        "char_count": len(text),
        "doc_index": len(session.project_docs) - 1,
    }


async def _hm_ask_generator(request: AskRequest):
    session = get_session(request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found. Please restart."}))
        return

    question = request.question.strip()
    if not question:
        yield _sse("error", json.dumps({"message": "Question cannot be empty."}))
        return

    full_answer = ""
    try:
        async for token in stream_hm_answer(session, question):
            full_answer += token
            yield _sse("token", json.dumps({"text": token}))
            await asyncio.sleep(0)
    except Exception as exc:
        yield _sse("error", json.dumps({"message": f"Stream error: {exc}"}))
        return

    if full_answer:
        append_history(session, "user", question)
        append_history(session, "assistant", full_answer)
    yield _sse("done", "{}")


@router.post("/shortcuts")
async def hm_shortcuts(request: SessionRequest):
    """Generate context-aware quick-ask shortcuts from the session's documents."""
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please restart.")
    shortcuts = await generate_shortcuts(session)
    return {"shortcuts": shortcuts}


@router.post("/ask")
async def hm_ask(request: AskRequest):
    return StreamingResponse(
        _hm_ask_generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
