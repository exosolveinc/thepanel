"""SSE event formatting + cleanup helpers used by every streaming router."""
import asyncio
import json
from typing import AsyncIterator, Callable

from utils.logging import get_logger

logger = get_logger(__name__)


def sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


def sse_event(event: str, data) -> str:
    """Auto-JSON-encode dict/list payloads. Pass a string through as-is."""
    if isinstance(data, str):
        return sse(event, data)
    return sse(event, json.dumps(data))


def sse_error(message: str, code: str | None = None) -> str:
    payload: dict = {"message": message}
    if code:
        payload["code"] = code
    return sse_event("error", payload)


def sse_done(extra: dict | None = None) -> str:
    return sse_event("done", extra or {})


async def stream_with_cleanup(
    generator: AsyncIterator[str],
    *,
    on_disconnect: Callable[[], None] | None = None,
) -> AsyncIterator[str]:
    """Wrap an SSE async generator with disconnect-safe cleanup.

    - On client disconnect (CancelledError / GeneratorExit): runs `on_disconnect`
      synchronously, then re-raises. Cleanup must be sync because awaiting after
      GeneratorExit is not allowed (e.g. `task.cancel()`, `conn.close()`).
    - On Exception: yields a single sse_error and logs at warning with traceback.
    """
    try:
        async for chunk in generator:
            yield chunk
    except (asyncio.CancelledError, GeneratorExit):
        if on_disconnect is not None:
            try:
                on_disconnect()
            except Exception:
                logger.warning("on_disconnect cleanup raised", exc_info=True)
        raise
    except Exception as exc:
        logger.warning("SSE stream errored", exc_info=True)
        yield sse_error(f"Stream error: {exc}")
