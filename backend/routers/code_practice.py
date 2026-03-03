"""Coding Practice JSON + SSE endpoints."""
import json
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from models.db_models import User
from services.session_store import get_session
from services.code_practice_client import generate_problem, stream_evaluate_code
from services.auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api", tags=["code-practice"])


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


# ── Generate problem (JSON, non-streaming) ───────────────────────────

class ProblemRequest(BaseModel):
    session_id: str
    difficulty: str = "easy"


@router.post("/code-practice/problem")
async def get_problem(
    request: ProblemRequest,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await get_session(db, request.session_id)
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


async def _eval_generator(request: EvaluateCodeRequest, db: AsyncSession):
    session = await get_session(db, request.session_id)
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
async def evaluate_code(
    request: EvaluateCodeRequest,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return StreamingResponse(
        _eval_generator(request, db),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
