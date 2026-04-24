"""In-memory session store. No DB needed — sessions live for the browser tab."""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

SESSION_TTL_HOURS = 12


@dataclass
class Session:
    session_id: str
    resume_text: str
    job_description: str
    history: list[dict] = field(default_factory=list)  # [{role, content}]
    current_design: dict | None = None  # Latest system design structure
    created_at: datetime = field(default_factory=datetime.now)
    last_used: datetime = field(default_factory=datetime.now)


_store: dict[str, Session] = {}


def _cleanup_expired():
    cutoff = datetime.now() - timedelta(hours=SESSION_TTL_HOURS)
    expired = [sid for sid, s in _store.items() if s.last_used < cutoff]
    for sid in expired:
        del _store[sid]


def create_session(resume_text: str, job_description: str) -> Session:
    _cleanup_expired()
    sid = str(uuid.uuid4())
    session = Session(session_id=sid, resume_text=resume_text, job_description=job_description)
    _store[sid] = session
    return session


def get_session(session_id: str) -> Session | None:
    session = _store.get(session_id)
    if session:
        session.last_used = datetime.now()
    return session


def append_history(session: Session, role: str, content: str, max_turns: int = 10):
    session.history.append({"role": role, "content": content})
    # Keep last max_turns * 2 messages (user + assistant pairs)
    if len(session.history) > max_turns * 2:
        session.history = session.history[-(max_turns * 2):]
