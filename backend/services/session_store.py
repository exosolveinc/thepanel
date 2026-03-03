"""
Session store — DB-backed with in-memory cache for active sessions.

The Session dataclass interface is preserved exactly so that all service
files (groq_client, anthropic_client, etc.) continue to work unchanged.
"""
from __future__ import annotations

import uuid as _uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession as DBSession

from models.db_models import InterviewSession, Message


# ── The Session interface all services depend on ─────────────────────
@dataclass
class Session:
    session_id: str
    resume_text: str
    job_description: str
    instructions: str = ""
    history: list[dict] = field(default_factory=list)  # [{role, content}]
    current_design: dict | None = None  # Latest system design structure


# ── In-memory cache for hot sessions ─────────────────────────────────
_cache: dict[str, Session] = {}


async def create_session(
    db: DBSession,
    user_id: _uuid.UUID,
    resume_text: str,
    job_description: str,
    resume_id: _uuid.UUID | None = None,
    jd_id: _uuid.UUID | None = None,
    folder_id: _uuid.UUID | None = None,
    instructions: str = "",
) -> Session:
    """Create a new interview session in DB and return a Session dataclass."""
    db_session = InterviewSession(
        user_id=user_id,
        folder_id=folder_id,
        resume_id=resume_id,
        jd_id=jd_id,
        resume_text=resume_text,
        job_description=job_description,
        instructions=instructions or None,
    )
    db.add(db_session)
    await db.commit()
    await db.refresh(db_session)

    session = Session(
        session_id=str(db_session.id),
        resume_text=resume_text,
        job_description=job_description,
        instructions=instructions,
    )
    _cache[session.session_id] = session
    return session


async def get_session(db: DBSession, session_id: str) -> Session | None:
    """Load session from cache or DB. Returns None if not found."""
    if session_id in _cache:
        return _cache[session_id]

    try:
        sid = _uuid.UUID(session_id)
    except ValueError:
        return None

    result = await db.execute(
        select(InterviewSession).where(InterviewSession.id == sid)
    )
    db_session = result.scalar_one_or_none()
    if not db_session:
        return None

    # Load message history
    msg_result = await db.execute(
        select(Message)
        .where(Message.session_id == sid)
        .order_by(Message.created_at)
    )
    messages = msg_result.scalars().all()

    history = [{"role": m.role, "content": m.content} for m in messages]

    # Find latest design_data
    current_design = None
    for m in reversed(messages):
        if m.design_data:
            current_design = m.design_data
            break

    session = Session(
        session_id=session_id,
        resume_text=db_session.resume_text,
        job_description=db_session.job_description,
        instructions=db_session.instructions or "",
        history=history,
        current_design=current_design,
    )
    _cache[session_id] = session
    return session


async def append_history(
    db: DBSession,
    session: Session,
    role: str,
    content: str,
    max_turns: int = 10,
    message_type: str | None = None,
    mode: str | None = None,
    design_data: dict | None = None,
):
    """Append a message to both the in-memory Session and the DB."""
    # Update in-memory
    session.history.append({"role": role, "content": content})
    if len(session.history) > max_turns * 2:
        session.history = session.history[-(max_turns * 2):]

    if design_data:
        session.current_design = design_data

    # Persist to DB
    sid = _uuid.UUID(session.session_id)
    msg = Message(
        session_id=sid,
        role=role,
        content=content,
        message_type=message_type,
        mode=mode,
        design_data=design_data,
    )
    db.add(msg)

    # Track question stats on the session row
    if role == "user":
        result = await db.execute(
            select(InterviewSession).where(InterviewSession.id == sid)
        )
        db_session = result.scalar_one_or_none()
        if db_session:
            db_session.question_count = (db_session.question_count or 0) + 1
            db_session.last_question = content

    await db.commit()
