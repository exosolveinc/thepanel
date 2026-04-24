"""Shared fixtures for integration tests."""
import pytest
from fastapi.testclient import TestClient
from main import app
from services.session_store import create_session, get_session


@pytest.fixture(scope="module")
def client():
    """Sync test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture()
def session():
    """Create a fresh test session with dummy resume + JD."""
    s = create_session(
        resume_text="John Doe, Software Engineer. 5 years experience with Python, FastAPI, React, AWS, PostgreSQL. Built RAG pipelines and microservices.",
        job_description="Senior Software Engineer role. Python, AWS, distributed systems, AI/ML experience preferred.",
    )
    return s
