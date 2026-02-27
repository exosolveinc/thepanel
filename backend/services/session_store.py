"""In-memory session store. No DB needed — sessions live for the browser tab."""
import uuid
from dataclasses import dataclass, field


@dataclass
class Session:
    session_id: str
    resume_text: str
    job_description: str
    history: list[dict] = field(default_factory=list)  # [{role, content}]
    current_design: dict | None = None  # Latest system design structure


_store: dict[str, Session] = {}


def create_session(resume_text: str, job_description: str) -> Session:
    sid = str(uuid.uuid4())
    session = Session(session_id=sid, resume_text=resume_text, job_description=job_description)
    _store[sid] = session
    return session


def get_session(session_id: str) -> Session | None:
    return _store.get(session_id)


def append_history(session: Session, role: str, content: str, max_turns: int = 10):
    session.history.append({"role": role, "content": content})
    # Keep last max_turns * 2 messages (user + assistant pairs)
    if len(session.history) > max_turns * 2:
        session.history = session.history[-(max_turns * 2):]
