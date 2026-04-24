"""Unit tests for utils/history.py — token-budget truncation."""
from utils.history import estimate_tokens, truncate_for_llm


def test_estimate_tokens_empty():
    assert estimate_tokens("") == 1


def test_estimate_tokens_roughly_4_chars_per_token():
    assert estimate_tokens("a" * 100) == 25


def test_truncate_empty_history():
    assert truncate_for_llm([]) == []


def test_truncate_under_budget_returns_all():
    history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
        {"role": "user", "content": "more"},
    ]
    assert truncate_for_llm(history, token_budget=1000) == history


def test_truncate_over_budget_keeps_newest():
    history = [{"role": "user", "content": "x" * 4000}] * 5  # ~1000 tokens each
    out = truncate_for_llm(history, token_budget=2500)
    assert 1 <= len(out) <= 3
    # Kept the tail (newest), in chronological order — which is the same content here.
    assert all(m["content"] == "x" * 4000 for m in out)


def test_truncate_respects_max_messages():
    history = [{"role": "user", "content": "small"} for _ in range(50)]
    out = truncate_for_llm(history, token_budget=1_000_000, max_messages=5)
    assert len(out) == 5


def test_truncate_keeps_at_least_newest_even_if_over_budget():
    huge = "x" * 100_000  # > any reasonable budget on its own
    out = truncate_for_llm([{"role": "user", "content": huge}], token_budget=10)
    assert len(out) == 1
    assert out[0]["content"] == huge


def test_truncate_preserves_chronological_order():
    history = [
        {"role": "user", "content": f"msg-{i}"}
        for i in range(20)
    ]
    out = truncate_for_llm(history, token_budget=200)
    assert out == sorted(out, key=lambda m: int(m["content"].split("-")[1]))
