"""
SSE streaming endpoints.

Event stream protocol:
  event: question_type   data: {"type": "basic"|"behavioral"|"system_design", "mode": "quick"|"long"|"design"}
  event: design          data: {DesignStructure JSON}
  event: token           data: {"text": "..."}
  event: done            data: {}
  event: error           data: {"message": "..."}
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import AskRequest, DrillRequest, FollowUpsRequest, AnswerMode
from services.session_store import get_session, append_history
from services.question_classifier import classify_question, is_coding_question
from services.groq_client import stream_basic_answer, stream_system_design, generate_follow_ups
from services.anthropic_client import stream_drill_down
from utils.sse import sse_event, sse_error, sse_done, stream_with_cleanup
from utils.logging import get_logger

router = APIRouter(prefix="/api", tags=["interview"])
logger = get_logger(__name__)

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _ask_generator(request: AskRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found. Please restart.")
        return

    question = request.question.strip()
    if not question:
        yield sse_error("Question cannot be empty.")
        return

    mode = request.mode
    if mode == AnswerMode.DESIGN:
        q_type = "system_design"
    else:
        q_type = await classify_question(question)

    answer_mode = mode.value
    if q_type != "system_design" and is_coding_question(question):
        answer_mode = "code"

    yield sse_event("question_type", {"type": q_type, "mode": answer_mode})
    await asyncio.sleep(0)

    full_answer = ""
    try:
        if q_type == "system_design":
            async for event_type, payload in stream_system_design(session, question):
                if event_type == "design":
                    try:
                        session.current_design = json.loads(payload)
                    except json.JSONDecodeError:
                        pass
                    yield sse_event("design", payload)
                else:
                    full_answer += payload
                    yield sse_event("token", {"text": payload})
                await asyncio.sleep(0)
        else:
            async for token in stream_basic_answer(session, question, mode=answer_mode):
                full_answer += token
                yield sse_event("token", {"text": token})
                await asyncio.sleep(0)
    except Exception as exc:
        logger.warning("ask stream errored", exc_info=True)
        yield sse_error(f"Stream error: {exc}")
        if full_answer:
            append_history(session, "user", question)
            append_history(session, "assistant", full_answer)
        return

    if full_answer:
        append_history(session, "user", question)
        append_history(session, "assistant", full_answer)
    yield sse_done()


async def _drill_generator(request: DrillRequest):
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found.")
        return

    design = session.current_design or {}
    design_title = design.get("title", "the system")
    design_summary = design.get("summary", "")

    async for token in stream_drill_down(
        session=session,
        component_name=request.component_name,
        design_title=design_title,
        design_summary=design_summary,
        depth=request.depth,
        sub_component=request.context,
    ):
        yield sse_event("token", {"text": token})
        await asyncio.sleep(0)

    yield sse_done()


async def _live_ask_generator(request: AskRequest):
    """Live voice panel — skips classification for immediate first-token response."""
    session = get_session(request.session_id)
    if not session:
        yield sse_error("Session not found. Please restart.")
        return

    question = request.question.strip()
    if not question:
        yield sse_error("Question cannot be empty.")
        return

    full_answer = ""
    async for token in stream_basic_answer(session, question, mode="quick"):
        full_answer += token
        yield sse_event("token", {"text": token})
        await asyncio.sleep(0)

    if full_answer:
        append_history(session, "user", question)
        append_history(session, "assistant", full_answer)
    yield sse_done()


@router.post("/ask")
async def ask_question(request: AskRequest):
    return StreamingResponse(
        stream_with_cleanup(_ask_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/live-ask")
async def live_ask(request: AskRequest):
    return StreamingResponse(
        stream_with_cleanup(_live_ask_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/drill")
async def drill_component(request: DrillRequest):
    return StreamingResponse(
        stream_with_cleanup(_drill_generator(request)),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/follow-ups")
async def follow_ups(request: FollowUpsRequest):
    session = get_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please restart.")
    questions = await generate_follow_ups(session, request.question, request.answer)
    return {"questions": questions}
