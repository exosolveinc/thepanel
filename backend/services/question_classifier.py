"""Fast question classification using Groq's small model (~50ms)."""
from groq import AsyncGroq
from config import settings

_client = AsyncGroq(api_key=settings.groq_api_key)

_CLASSIFY_PROMPT = """Classify this interview question into exactly one category:
- basic: Factual/conceptual (what is X, explain Y, how does Z work, difference between A and B)
- behavioral: Experience-based (tell me about a time, how did you handle, describe a situation)
- system_design: Design/architecture (design X, how would you build Y, architect a system for Z)

Question: {question}

Reply with only the category word: basic, behavioral, or system_design"""

# First words that indicate "please write code for me"
_CODING_FIRST_WORDS = frozenset([
    "code", "write", "implement", "program", "solve", "script", "build",
    "create", "develop", "code-the", "show",
])


def is_coding_question(question: str) -> bool:
    """Keyword-only check — no LLM needed. True when the user wants code written."""
    words = question.strip().lower().split()
    if not words:
        return False
    # First word signals coding intent
    if words[0] in _CODING_FIRST_WORDS:
        return True
    # "write me a ...", "can you code ...", "please implement ..."
    if len(words) >= 2 and words[1] in _CODING_FIRST_WORDS:
        return True
    return False


async def classify_question(question: str) -> str:
    response = await _client.chat.completions.create(
        model=settings.groq_fast_model,
        messages=[{"role": "user", "content": _CLASSIFY_PROMPT.format(question=question)}],
        max_tokens=10,
        temperature=0,
    )
    raw = response.choices[0].message.content.strip().lower()
    if "system_design" in raw or "system design" in raw:
        return "system_design"
    if "behavioral" in raw:
        return "behavioral"
    return "basic"
