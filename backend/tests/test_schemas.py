"""Unit tests for Pydantic schema constraints."""
import pytest
from pydantic import ValidationError

from models.schemas import (
    AskRequest,
    EvaluateCodeRequest,
    EvaluateRequest,
    ErrorResponse,
)


def test_ask_request_rejects_empty_question():
    with pytest.raises(ValidationError):
        AskRequest(session_id="s", question="")


def test_ask_request_rejects_oversized_question():
    with pytest.raises(ValidationError):
        AskRequest(session_id="s", question="x" * 10_001)


def test_ask_request_accepts_valid():
    r = AskRequest(session_id="s", question="hello")
    assert r.mode.value == "quick"


def test_evaluate_code_request_caps_code_at_50k():
    with pytest.raises(ValidationError):
        EvaluateCodeRequest(
            session_id="s",
            problem_title="t",
            problem_description="d",
            code="x" * 50_001,
            language="python",
        )


def test_evaluate_code_request_50k_exact_is_ok():
    r = EvaluateCodeRequest(
        session_id="s",
        problem_title="t",
        problem_description="d",
        code="x" * 50_000,
        language="python",
    )
    assert len(r.code) == 50_000


def test_evaluate_code_request_rejects_empty_code():
    with pytest.raises(ValidationError):
        EvaluateCodeRequest(
            session_id="s",
            problem_title="t",
            problem_description="d",
            code="",
            language="python",
        )


def test_evaluate_request_caps_answer_at_20k():
    with pytest.raises(ValidationError):
        EvaluateRequest(session_id="s", question="q", answer="x" * 20_001)


def test_error_response_serializes_with_optional_code():
    e = ErrorResponse(message="oh no")
    d = e.model_dump()
    assert d == {"message": "oh no", "code": None}
