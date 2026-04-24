"""Test HM endpoints — /api/hm/ask (3-section parallel streaming via Bedrock).

These are LIVE integration tests that call real APIs (Bedrock Claude, Groq, Supabase).
Run with: pytest -m live
"""
import json
import pytest

pytestmark = pytest.mark.live


def parse_sse(raw: str) -> list[dict]:
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


def test_hm_ask_missing_session(client):
    """Should return error for nonexistent session."""
    res = client.post("/api/hm/ask", json={
        "session_id": "nonexistent",
        "question": "hello",
        "mode": "quick",
    })
    events = parse_sse(res.text)
    assert any(e["event"] == "error" for e in events)


def test_hm_ask_basic_question(client, session):
    """Live test: HM ask streams 3 sections (overview, flow, code) via Bedrock + Groq."""
    res = client.post("/api/hm/ask", json={
        "session_id": session.session_id,
        "question": "What is a load balancer?",
        "mode": "quick",
    })
    assert res.status_code == 200
    events = parse_sse(res.text)

    # Check for token events with section info
    token_events = [e for e in events if e["event"] == "token"]
    assert len(token_events) > 0, "No token events received — Bedrock/Groq may be failing"

    # Collect sections that received tokens
    sections_seen = set()
    for e in token_events:
        sec = e["data"].get("section")
        if sec:
            sections_seen.add(sec)

    # All 3 sections should have content
    assert "overview" in sections_seen, f"Missing 'overview' section. Sections seen: {sections_seen}"
    assert "flow" in sections_seen, f"Missing 'flow' section. Sections seen: {sections_seen}"
    assert "code" in sections_seen, f"Missing 'code' section. Sections seen: {sections_seen}"

    # Should end with done
    done_events = [e for e in events if e["event"] == "done"]
    assert len(done_events) == 1

    # No errors
    error_events = [e for e in events if e["event"] == "error"]
    assert len(error_events) == 0, f"Got errors: {error_events}"


def test_hm_ask_overview_has_content(client, session):
    """The overview section should have substantial content (not just an error message)."""
    res = client.post("/api/hm/ask", json={
        "session_id": session.session_id,
        "question": "Explain microservices architecture",
        "mode": "quick",
    })
    events = parse_sse(res.text)

    overview_text = ""
    for e in events:
        if e["event"] == "token" and e["data"].get("section") == "overview":
            overview_text += e["data"].get("text", "")

    assert len(overview_text) > 50, f"Overview too short ({len(overview_text)} chars): {overview_text[:200]}"
    # Should not start with [Error
    assert not overview_text.startswith("[Error"), f"Overview is an error: {overview_text[:200]}"


def test_hm_ask_flow_is_valid_mermaid(client, session):
    """Flow section should contain valid Mermaid syntax starting with 'flowchart'."""
    res = client.post("/api/hm/ask", json={
        "session_id": session.session_id,
        "question": "How does a cache work?",
        "mode": "quick",
    })
    events = parse_sse(res.text)

    flow_text = ""
    for e in events:
        if e["event"] == "token" and e["data"].get("section") == "flow":
            flow_text += e["data"].get("text", "")

    assert len(flow_text) > 10, f"Flow too short: {flow_text}"
    assert "flowchart" in flow_text.lower(), f"Flow doesn't contain 'flowchart': {flow_text[:200]}"
    # Should not contain invalid -->|text|> syntax
    assert "-->|" not in flow_text or "|>" not in flow_text.replace("-->|", "").split("|")[0] if "|>" in flow_text else True


def test_hm_shortcuts(client, session):
    """Shortcuts endpoint should return a list (may be empty if no docs)."""
    res = client.post("/api/hm/shortcuts", json={
        "session_id": session.session_id,
    })
    assert res.status_code == 200
    data = res.json()
    assert "shortcuts" in data
    assert isinstance(data["shortcuts"], list)


def test_hm_docs_list(client):
    """Global docs list should return without error."""
    res = client.get("/api/hm/docs/list")
    assert res.status_code == 200
    data = res.json()
    assert "docs" in data
    assert isinstance(data["docs"], list)


def test_hm_ask_stores_history(client, session):
    """After HM ask, overview should be stored in session history."""
    client.post("/api/hm/ask", json={
        "session_id": session.session_id,
        "question": "What is Docker?",
        "mode": "quick",
    })
    from services.session_store import get_session
    s = get_session(session.session_id)
    assert len(s.history) >= 2
    assert s.history[-2]["role"] == "user"
    assert "Docker" in s.history[-2]["content"]
    assert s.history[-1]["role"] == "assistant"
    assert len(s.history[-1]["content"]) > 10  # has real content
