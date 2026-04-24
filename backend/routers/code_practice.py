"""Coding Practice JSON + SSE endpoints."""
import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import ProblemRequest, EvaluateCodeRequest
from services.session_store import get_session
from services.code_practice_client import generate_problem, stream_evaluate_code
from utils.sse import sse_event, sse_error, sse_done, stream_with_cleanup

router = APIRouter(prefix="/api", tags=["code-practice"])
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/code-practice/problem")
async def get_problem(request: ProblemRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please restart.")
    problem = await generate_problem(session, request.difficulty)
    return {"problem": problem}


async def _eval_generator(request: EvaluateCodeRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found.")
        return

    if not request.code.strip():
        yield sse_error("No code submitted.")
        return

    async for token in stream_evaluate_code(
        session,
        request.problem_title,
        request.problem_description,
        request.code,
        request.language,
    ):
        yield sse_event("token", {"text": token})
        await asyncio.sleep(0)
    yield sse_done()


@router.post("/code-practice/evaluate")
async def evaluate_code(request: EvaluateCodeRequest):
    return StreamingResponse(
        stream_with_cleanup(_eval_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
