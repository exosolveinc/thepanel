"""Token-budget-aware history truncation for LLM prompts."""


def estimate_tokens(text: str) -> int:
    """Rough estimator: ~4 chars per token for Claude/Llama-style tokenizers."""
    return max(1, len(text) // 4)


def truncate_for_llm(
    history: list[dict],
    token_budget: int = 8000,
    max_messages: int = 20,
) -> list[dict]:
    """Walk history newest→oldest, keep messages until budget OR max_messages exceeded.
    Returns the kept slice in chronological order.
    """
    if not history:
        return []

    kept: list[dict] = []
    used = 0
    for msg in reversed(history):
        content = str(msg.get("content", ""))
        cost = estimate_tokens(content) + 4  # small per-message overhead
        if kept and (used + cost > token_budget or len(kept) >= max_messages):
            break
        kept.append(msg)
        used += cost

    kept.reverse()
    return kept
