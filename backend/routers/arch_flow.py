"""Architecture Flow SSE endpoint — streams Claude-generated stepwise architecture breakdowns."""
import asyncio

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from models.schemas import ArchFlowRequest
from services.session_store import get_session
from services.arch_flow_client import stream_arch_flow
from utils.sse import sse_event, sse_error, sse_done, stream_with_cleanup

router = APIRouter(prefix="/api", tags=["arch-flow"])
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _generator(request: ArchFlowRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found.")
        return

    question = request.question.strip()
    if not question:
        yield sse_error("Question cannot be empty.")
        return

    async for token in stream_arch_flow(session, question):
        yield sse_event("token", {"text": token})
        await asyncio.sleep(0)
    yield sse_done()


@router.post("/arch-flow")
async def arch_flow(request: ArchFlowRequest):
    return StreamingResponse(
        stream_with_cleanup(_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
