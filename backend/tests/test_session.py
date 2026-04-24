"""Test session creation and management."""
from services.session_store import create_session, get_session, append_history


def test_create_session():
    s = create_session("resume text", "job description")
    assert s.session_id
    assert s.resume_text == "resume text"
    assert s.job_description == "job description"
    assert s.history == []


def test_get_session():
    s = create_session("r", "j")
    fetched = get_session(s.session_id)
    assert fetched is not None
    assert fetched.session_id == s.session_id


def test_get_nonexistent_session():
    assert get_session("nonexistent-id-12345") is None


def test_append_history():
    s = create_session("r", "j")
    append_history(s, "user", "hello")
    append_history(s, "assistant", "hi there")
    assert len(s.history) == 2
    assert s.history[0]["role"] == "user"
    assert s.history[1]["role"] == "assistant"


def test_history_limit():
    s = create_session("r", "j")
    for i in range(30):
        append_history(s, "user", f"q{i}")
        append_history(s, "assistant", f"a{i}")
    # max_history_turns=10 means 20 messages (10 pairs)
    assert len(s.history) <= 20
