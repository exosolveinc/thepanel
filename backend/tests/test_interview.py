"""Test interview endpoints — /api/ask, /api/live-ask.

These are LIVE integration tests that call real LLM APIs (Groq, Anthropic).
Run with: pytest -m live
"""
import json
import pytest

pytestmark = pytest.mark.live


def parse_sse(raw: str) -> list[dict]:
    """Parse SSE text into list of {event, data} dicts."""
    events = []
    for block in raw.split("\n\n"):
        if not block.strip():
            continue
        event = "message"
        data = ""
        for line in block.strip().split("\n"):
            if line.startswith("event: "):
                event = line[7:].strip()
            elif line.startswith("data: "):
                data = line[6:]
        if data:
            try:
                events.append({"event": event, "data": json.loads(data)})
            except json.JSONDecodeError:
                events.append({"event": event, "data": data})
    return events


def test_ask_missing_session(client):
    """Should return error SSE event for nonexistent session."""
    res = client.post("/api/ask", json={
        "session_id": "nonexistent",
        "question": "hello",
        "mode": "quick",
    })
    assert res.status_code == 200  # SSE always returns 200
    events = parse_sse(res.text)
    assert any(e["event"] == "error" for e in events)


def test_ask_empty_question(client, session):
    """Should return error for empty question."""
    res = client.post("/api/ask", json={
        "session_id": session.session_id,
        "question": "",
        "mode": "quick",
    })
    # Pydantic validation should reject min_length=1
    assert res.status_code == 422


def test_ask_basic_question(client, session):
    """Live test: ask a basic question and verify SSE stream."""
    res = client.post("/api/ask", json={
        "session_id": session.session_id,
        "question": "What is Python?",
        "mode": "quick",
    })
    assert res.status_code == 200
    events = parse_sse(res.text)

    # Should have question_type event
    qt_events = [e for e in events if e["event"] == "question_type"]
    assert len(qt_events) >= 1
    assert qt_events[0]["data"]["type"] in ("basic", "behavioral", "system_design")

    # Should have token events
    token_events = [e for e in events if e["event"] == "token"]
    assert len(token_events) > 0

    # Should have done event
    done_events = [e for e in events if e["event"] == "done"]
    assert len(done_events) == 1

    # No error events
    error_events = [e for e in events if e["event"] == "error"]
    assert len(error_events) == 0


def test_live_ask(client, session):
    """Live test: /api/live-ask skips classifier, streams immediately."""
    res = client.post("/api/live-ask", json={
        "session_id": session.session_id,
        "question": "Explain REST APIs briefly",
        "mode": "quick",
    })
    assert res.status_code == 200
    events = parse_sse(res.text)

    # Should NOT have question_type event (live-ask skips classifier)
    qt_events = [e for e in events if e["event"] == "question_type"]
    assert len(qt_events) == 0

    # Should have tokens
    token_events = [e for e in events if e["event"] == "token"]
    assert len(token_events) > 0

    # Should end with done
    done_events = [e for e in events if e["event"] == "done"]
    assert len(done_events) == 1

    error_events = [e for e in events if e["event"] == "error"]
    assert len(error_events) == 0


def test_ask_question_stored_in_history(client, session):
    """After asking, history should contain the Q&A pair."""
    client.post("/api/ask", json={
        "session_id": session.session_id,
        "question": "What is a database?",
        "mode": "quick",
    })
    from services.session_store import get_session
    s = get_session(session.session_id)
    assert len(s.history) >= 2
    assert s.history[-2]["role"] == "user"
    assert s.history[-1]["role"] == "assistant"
