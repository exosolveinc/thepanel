"""
Coding Practice client.
- generate_problem(): Groq fast JSON — one coding problem for given difficulty
- stream_evaluate_code(): Claude streaming — detailed code review + score
"""
import json
import re
from groq import AsyncGroq
import anthropic
from config import settings
from services.session_store import Session

_groq   = AsyncGroq(api_key=settings.groq_api_key)
_claude = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


# ── Problem generation ────────────────────────────────────────────────

async def generate_problem(session: Session, difficulty: str = "easy") -> dict:
    """Returns a single coding problem dict (non-streaming via Groq)."""
    role_context = session.job_description[:400]
    instructions_note = f"\nCustom Instructions:\n{session.instructions[:300]}\n" if session.instructions else ""

    prompt = f"""Generate a {difficulty} coding problem for a software engineering interview.

Role context: {role_context}
{instructions_note}

Return ONLY a valid JSON object — no markdown, no extra text:
{{
  "id": "1",
  "title": "Problem Name",
  "difficulty": "{difficulty}",
  "description": "Full problem description with clear input/output specification.",
  "examples": [
    "Input: ...\\nOutput: ...\\nExplanation: ...",
    "Input: ...\\nOutput: ..."
  ],
  "constraints": [
    "1 <= n <= 10^4",
    "Array elements are integers"
  ],
  "hint": "Think about using a hash map for O(1) lookups.",
  "expected_time": "O(n)",
  "expected_space": "O(n)"
}}

Difficulty guidelines:
- easy: array/string manipulation (two sum, anagram, palindrome, reverse, FizzBuzz)
- medium: trees, linked lists, sliding window, two pointers, basic DP
- hard: graph algorithms, advanced DP, complex data structures

Make the problem clear, unambiguous, and solvable in 15-30 minutes."""

    response = await _groq.chat.completions.create(
        model=settings.groq_main_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000,
        temperature=0.5,
        stream=False,
    )
    raw = response.choices[0].message.content or "{}"

    # Strip markdown fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)

    # Extract JSON object
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return _fallback_problem(difficulty)

    try:
        problem = json.loads(m.group())
        if problem.get("title") and problem.get("description"):
            return problem
        return _fallback_problem(difficulty)
    except (json.JSONDecodeError, TypeError):
        return _fallback_problem(difficulty)


def _fallback_problem(difficulty: str) -> dict:
    if difficulty == "medium":
        return {
            "id": "fb",
            "title": "Longest Substring Without Repeating Characters",
            "difficulty": "medium",
            "description": "Given a string s, find the length of the longest substring without repeating characters.",
            "examples": [
                "Input: s = \"abcabcbb\"\nOutput: 3\nExplanation: \"abc\" has length 3.",
                "Input: s = \"bbbbb\"\nOutput: 1",
            ],
            "constraints": ["0 <= s.length <= 5 * 10^4", "s consists of English letters, digits, symbols and spaces"],
            "hint": "Use a sliding window with a hash set.",
            "expected_time": "O(n)",
            "expected_space": "O(min(m, n))",
        }
    if difficulty == "hard":
        return {
            "id": "fb",
            "title": "Word Ladder",
            "difficulty": "hard",
            "description": "Given two words beginWord and endWord, and a dictionary wordList, return the length of the shortest transformation sequence from beginWord to endWord, such that only one letter can be changed at a time and each transformed word must exist in wordList.",
            "examples": [
                "Input: beginWord = \"hit\", endWord = \"cog\", wordList = [\"hot\",\"dot\",\"dog\",\"lot\",\"log\",\"cog\"]\nOutput: 5\nExplanation: hit → hot → dot → dog → cog",
            ],
            "constraints": ["1 <= beginWord.length <= 10", "beginWord != endWord", "1 <= wordList.length <= 5000"],
            "hint": "Use BFS — treat each word as a graph node.",
            "expected_time": "O(M^2 * N)",
            "expected_space": "O(M^2 * N)",
        }
    # easy default
    return {
        "id": "fb",
        "title": "Valid Anagram",
        "difficulty": "easy",
        "description": "Given two strings s and t, return true if t is an anagram of s, and false otherwise. An anagram is a word formed by rearranging the letters of another word.",
        "examples": [
            "Input: s = \"anagram\", t = \"nagaram\"\nOutput: true",
            "Input: s = \"rat\", t = \"car\"\nOutput: false",
        ],
        "constraints": ["1 <= s.length, t.length <= 5 * 10^4", "s and t consist of lowercase English letters"],
        "hint": "Count character frequencies using a hash map or sort both strings.",
        "expected_time": "O(n)",
        "expected_space": "O(1)",
    }


# ── Code evaluation ───────────────────────────────────────────────────

_CODE_EVAL_SYSTEM = """You are a senior software engineer reviewing a coding interview submission.
Be specific, honest, and constructive. Focus on correctness first, then quality."""

async def stream_evaluate_code(
    session: Session,
    problem_title: str,
    problem_description: str,
    code: str,
    language: str,
):
    """Async generator — streams code evaluation tokens."""
    user_msg = f"""Problem: {problem_title}
{problem_description}

Language: {language}
Submitted Code:
```{language}
{code}
```

Evaluate using exactly these headers:

## Score
[X/10]

## Correctness
Does this solve the problem? Walk through the logic. Note any bugs or cases where it fails.

## Time & Space Complexity
- Time: O(...) — [reason]
- Space: O(...) — [reason]
[Is this optimal? What's the best possible?]

## Code Quality
[Comments on naming, readability, edge case handling]

## Issues Found
[Specific bugs, missing edge cases, or logic errors — be precise]

## Better Approach (if applicable)
```{language}
[Cleaner or more optimal solution — only if meaningfully different]
```"""

    async with _claude.messages.stream(
        model=settings.claude_sonnet_model,
        max_tokens=800,
        system=_CODE_EVAL_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
