"""
SSE streaming endpoints.

Event stream protocol:
  event: question_type   data: {"type": "basic"|"behavioral"|"system_design", "mode": "quick"|"long"|"design"}
  event: design          data: {DesignStructure JSON}
  event: token           data: {"text": "..."}
  event: done            data: {}
  event: error           data: {"message": "..."}
"""
import json
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from models.schemas import AskRequest, DrillRequest, AnswerMode
from services.session_store import get_session, append_history
from services.question_classifier import classify_question, is_coding_question
from services.groq_client import stream_basic_answer, stream_system_design
from services.anthropic_client import stream_drill_down

router = APIRouter(prefix="/api", tags=["interview"])


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


async def _ask_generator(request: AskRequest):
    session = get_session(request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found. Please restart."}))
        return

    question = request.question.strip()
    if not question:
        yield _sse("error", json.dumps({"message": "Question cannot be empty."}))
        return

    mode = request.mode

    # Determine question type — Design mode bypasses classifier
    if mode == AnswerMode.DESIGN:
        q_type = "system_design"
    else:
        q_type = await classify_question(question)

    # Detect coding intent: "code X", "write X", "implement X", etc.
    # Force code mode regardless of which answer button the user clicked
    answer_mode = mode.value
    if q_type != "system_design" and is_coding_question(question):
        answer_mode = "code"

    yield _sse("question_type", json.dumps({"type": q_type, "mode": answer_mode}))
    await asyncio.sleep(0)

    full_answer = ""

    if q_type == "system_design":
        async for event_type, payload in stream_system_design(session, question):
            if event_type == "design":
                session.current_design = json.loads(payload)
                yield _sse("design", payload)
                await asyncio.sleep(0)
            else:
                full_answer += payload
                yield _sse("token", json.dumps({"text": payload}))
                await asyncio.sleep(0)
    else:
        async for token in stream_basic_answer(session, question, mode=answer_mode):
            full_answer += token
            yield _sse("token", json.dumps({"text": token}))
            await asyncio.sleep(0)

    append_history(session, "user", question)
    append_history(session, "assistant", full_answer)
    yield _sse("done", "{}")


async def _drill_generator(request: DrillRequest):
    session = get_session(request.session_id)
    if not session:
        yield _sse("error", json.dumps({"message": "Session not found."}))
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
        yield _sse("token", json.dumps({"text": token}))
        await asyncio.sleep(0)

    yield _sse("done", "{}")


@router.post("/ask")
async def ask_question(request: AskRequest):
    return StreamingResponse(
        _ask_generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/drill")
async def drill_component(request: DrillRequest):
    return StreamingResponse(
        _drill_generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
