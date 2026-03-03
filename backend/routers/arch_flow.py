"""Architecture Flow SSE endpoint — streams Claude-generated stepwise architecture breakdowns."""
import json
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from models.db_models import User
from services.session_store import get_session
from services.arch_flow_client import stream_arch_flow
from services.auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api", tags=["arch-flow"])


class ArchFlowRequest(BaseModel):
    session_id: str
    question: str


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


async def _generator(request: ArchFlowRequest, db: AsyncSession):
    session = await get_session(db, request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found."}))
        return

    question = request.question.strip()
    if not question:
        yield _sse("error", json.dumps({"message": "Question cannot be empty."}))
        return

    try:
        async for token in stream_arch_flow(session, question):
            yield _sse("token", json.dumps({"text": token}))
            await asyncio.sleep(0)
    except Exception as e:
        yield _sse("error", json.dumps({"message": str(e)}))
        return

    yield _sse("done", "{}")


@router.post("/arch-flow")
async def arch_flow(
    request: ArchFlowRequest,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return StreamingResponse(
        _generator(request, db),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
