"""Practice Interview SSE + JSON endpoints."""
import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import QuestionsRequest, EvaluateRequest, SummaryRequest
from services.session_store import get_session
from services.practice_client import (
    generate_questions,
    stream_evaluate_answer,
    stream_practice_summary,
)
from utils.sse import sse_event, sse_error, sse_done, stream_with_cleanup

router = APIRouter(prefix="/api", tags=["practice"])
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/practice/questions")
async def get_practice_questions(request: QuestionsRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please restart.")
    questions = await generate_questions(session, request.count, request.question_type)
    return {"questions": questions}


async def _eval_generator(request: EvaluateRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found.")
        return
    async for token in stream_evaluate_answer(
        session, request.question, request.answer, request.difficulty
    ):
        yield sse_event("token", {"text": token})
        await asyncio.sleep(0)
    yield sse_done()


@router.post("/practice/evaluate")
async def evaluate_answer(request: EvaluateRequest):
    return StreamingResponse(
        stream_with_cleanup(_eval_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


async def _summary_generator(request: SummaryRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found.")
        return
    async for token in stream_practice_summary(session, request.qa_pairs):
        yield sse_event("token", {"text": token})
        await asyncio.sleep(0)
    yield sse_done()


@router.post("/practice/summary")
async def practice_summary(request: SummaryRequest):
    return StreamingResponse(
        stream_with_cleanup(_summary_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
