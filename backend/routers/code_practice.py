"""Coding Practice JSON + SSE endpoints."""
import json
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.session_store import get_session
from services.code_practice_client import generate_problem, stream_evaluate_code

router = APIRouter(prefix="/api", tags=["code-practice"])


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


# ── Generate problem (JSON, non-streaming) ───────────────────────────

class ProblemRequest(BaseModel):
    session_id: str
    difficulty: str = "easy"


@router.post("/code-practice/problem")
async def get_problem(request: ProblemRequest):
    session = get_session(request.session_id)
    if not session:
        return {"error": "Session not found", "problem": None}
    problem = await generate_problem(session, request.difficulty)
    return {"problem": problem}


# ── Evaluate submitted code (SSE) ────────────────────────────────────

class EvaluateCodeRequest(BaseModel):
    session_id: str
    problem_title: str
    problem_description: str
    code: str
    language: str = "python"


async def _eval_generator(request: EvaluateCodeRequest):
    session = get_session(request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found."}))
        return

    if not request.code.strip():
        yield _sse("error", json.dumps({"message": "No code submitted."}))
        return

    try:
        async for token in stream_evaluate_code(
            session,
            request.problem_title,
            request.problem_description,
            request.code,
            request.language,
        ):
            yield _sse("token", json.dumps({"text": token}))
            await asyncio.sleep(0)
    except Exception as e:
        yield _sse("error", json.dumps({"message": str(e)}))
        return

    yield _sse("done", "{}")


@router.post("/code-practice/evaluate")
async def evaluate_code(request: EvaluateCodeRequest):
    return StreamingResponse(
        _eval_generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
