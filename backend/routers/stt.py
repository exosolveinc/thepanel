"""
STT WebSocket proxy — forwards audio from the browser to Deepgram using a
server-side Authorization header (bypasses browser subprotocol auth issues).

Browser  ←→  /api/stt  (FastAPI WS)  ←→  Deepgram WSS
"""
import asyncio
import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from config import settings
from utils.logging import get_logger

router = APIRouter(prefix="/api", tags=["stt"])
logger = get_logger(__name__)

DEEPGRAM_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2"
    "&language=en-US"
    "&smart_format=true"
    "&interim_results=true"
    "&vad_events=true"
    "&encoding=linear16"
    "&sample_rate=16000"
    "&channels=1"
)


def _allowed_origins() -> set[str]:
    return {o.strip() for o in settings.ws_allowed_origins.split(",") if o.strip()}


@router.websocket("/stt")
async def stt_proxy(ws: WebSocket):
    """Proxy WebSocket: browser ↔ backend ↔ Deepgram."""
    origin = ws.headers.get("origin")
    allowed = _allowed_origins()
    if not origin or origin not in allowed:
        logger.warning("STT websocket rejected from origin=%r (allowed=%s)", origin, sorted(allowed))
        await ws.close(code=1008)  # Policy Violation
        return

    await ws.accept()

    if not settings.deepgram_api_key:
        await ws.send_text('{"type":"error","message":"DEEPGRAM_API_KEY not configured."}')
        await ws.close()
        return

    try:
        async with websockets.connect(
            DEEPGRAM_URL,
            additional_headers={"Authorization": f"Token {settings.deepgram_api_key}"},
            close_timeout=10,
        ) as dg:

            async def browser_to_deepgram():
                """Forward binary audio chunks from browser → Deepgram."""
                try:
                    while True:
                        msg = await ws.receive()
                        if msg["type"] == "websocket.disconnect":
                            break
                        if msg.get("bytes"):
                            await dg.send(msg["bytes"])
                except (WebSocketDisconnect, RuntimeError):
                    pass
                finally:
                    await dg.close()

            async def deepgram_to_browser():
                """Forward JSON events from Deepgram → browser."""
                try:
                    async for message in dg:
                        text = message if isinstance(message, str) else message.decode()
                        await ws.send_text(text)
                except Exception:
                    pass

            # Run both directions; cancel the other when one finishes
            t1 = asyncio.create_task(browser_to_deepgram())
            t2 = asyncio.create_task(deepgram_to_browser())
            try:
                done, pending = await asyncio.wait(
                    [t1, t2], return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            except Exception:
                t1.cancel()
                t2.cancel()

    except websockets.exceptions.InvalidStatus as e:
        code = e.response.status_code if e.response else 0
        await ws.send_text(
            f'{{"type":"error","message":"Deepgram rejected connection (HTTP {code}). '
            f'Check API key or account credits."}}'
        )
        try:
            await ws.close()
        except Exception:
            pass
    except Exception as e:
        # Sanitize error — never expose API key in client-facing messages
        msg = str(e).replace(settings.deepgram_api_key, "***") if settings.deepgram_api_key else str(e)
        try:
            await ws.send_text(f'{{"type":"error","message":"STT proxy error: {msg}"}}')
            await ws.close()
        except Exception:
            pass
