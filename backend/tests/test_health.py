"""Test health endpoint and startup validation."""


def test_health_returns_ok(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "services" in data


def test_health_shows_service_status(client):
    data = client.get("/health").json()
    services = data["services"]
    assert isinstance(services["groq"], bool)
    assert isinstance(services["anthropic"], bool)
    assert isinstance(services["deepgram"], bool)
    assert isinstance(services["aws_bedrock"], bool)
    assert isinstance(services["supabase"], bool)
