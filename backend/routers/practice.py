"""Practice Interview SSE + JSON endpoints."""
import json
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.session_store import get_session
from services.practice_client import (
    generate_questions,
    stream_evaluate_answer,
    stream_practice_summary,
)

router = APIRouter(prefix="/api", tags=["practice"])


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


# ── Generate questions (JSON, non-streaming) ─────────────────────────

class QuestionsRequest(BaseModel):
    session_id: str
    count: int = 10
    question_type: str = "mixed"  # "behavioral" | "technical" | "mixed"


@router.post("/practice/questions")
async def get_practice_questions(request: QuestionsRequest):
    session = get_session(request.session_id)
    if not session:
        return {"error": "Session not found", "questions": []}
    questions = await generate_questions(session, request.count, request.question_type)
    return {"questions": questions}


# ── Evaluate single answer (SSE) ─────────────────────────────────────

class EvaluateRequest(BaseModel):
    session_id: str
    question: str
    answer: str
    difficulty: str = "medium"


async def _eval_generator(request: EvaluateRequest):
    session = get_session(request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found."}))
        return

    try:
        async for token in stream_evaluate_answer(
            session, request.question, request.answer, request.difficulty
        ):
            yield _sse("token", json.dumps({"text": token}))
            await asyncio.sleep(0)
    except Exception as e:
        yield _sse("error", json.dumps({"message": str(e)}))
        return

    yield _sse("done", "{}")


@router.post("/practice/evaluate")
async def evaluate_answer(request: EvaluateRequest):
    return StreamingResponse(
        _eval_generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Practice summary (SSE) ───────────────────────────────────────────

class SummaryRequest(BaseModel):
    session_id: str
    qa_pairs: list[dict]


async def _summary_generator(request: SummaryRequest):
    session = get_session(request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found."}))
        return

    try:
        async for token in stream_practice_summary(session, request.qa_pairs):
            yield _sse("token", json.dumps({"text": token}))
            await asyncio.sleep(0)
    except Exception as e:
        yield _sse("error", json.dumps({"message": str(e)}))
        return

    yield _sse("done", "{}")


@router.post("/practice/summary")
async def practice_summary(request: SummaryRequest):
    return StreamingResponse(
        _summary_generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
