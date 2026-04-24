"""Deep Dive SSE endpoint — streams Claude-generated comprehensive topic breakdowns."""
import asyncio

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from models.schemas import DeepDiveRequest
from services.session_store import get_session
from services.deep_dive_client import stream_deep_dive
from utils.sse import sse_event, sse_error, sse_done, stream_with_cleanup

router = APIRouter(prefix="/api", tags=["deep-dive"])
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _generator(request: DeepDiveRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found.")
        return

    topic = request.topic.strip()
    if not topic:
        yield sse_error("Topic cannot be empty.")
        return

    async for token in stream_deep_dive(session, topic):
        yield sse_event("token", {"text": token})
        await asyncio.sleep(0)
    yield sse_done()


@router.post("/deep-dive")
async def deep_dive(request: DeepDiveRequest):
    return StreamingResponse(
        stream_with_cleanup(_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
