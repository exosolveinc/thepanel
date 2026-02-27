"""Deep Dive SSE endpoint — streams Claude-generated comprehensive topic breakdowns."""
import json
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.session_store import get_session
from services.deep_dive_client import stream_deep_dive

router = APIRouter(prefix="/api", tags=["deep-dive"])


class DeepDiveRequest(BaseModel):
    session_id: str
    topic: str


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


async def _generator(request: DeepDiveRequest):
    session = get_session(request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found."}))
        return

    topic = request.topic.strip()
    if not topic:
        yield _sse("error", json.dumps({"message": "Topic cannot be empty."}))
        return

    try:
        async for token in stream_deep_dive(session, topic):
            yield _sse("token", json.dumps({"text": token}))
            await asyncio.sleep(0)
    except Exception as e:
        yield _sse("error", json.dumps({"message": str(e)}))
        return

    yield _sse("done", "{}")


@router.post("/deep-dive")
async def deep_dive(request: DeepDiveRequest):
    return StreamingResponse(
        _generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
