"""
Practice Interview client.
- generate_questions(): Groq fast JSON — N personalized interview questions
- stream_evaluate_answer(): Claude streaming — per-answer feedback + score
- stream_practice_summary(): Claude streaming — final strengths/weaknesses report
"""
import json
import re
from groq import AsyncGroq
import anthropic
from config import settings
from services.session_store import Session

_groq   = AsyncGroq(api_key=settings.groq_api_key)
_claude = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


# ── Question generation ──────────────────────────────────────────────

async def generate_questions(
    session: Session,
    count: int = 10,
    question_type: str = "mixed",
) -> list[dict]:
    """Returns a list of interview question dicts using Groq (fast, non-streaming)."""
    easy   = max(2, count // 4)
    medium = max(3, count // 2)
    hard   = count - easy - medium

    if question_type == "behavioral":
        breakdown = (
            f"- {easy} easy: icebreakers, background, motivation, why this company\n"
            f"- {medium} medium: leadership, conflict resolution, teamwork, handling failure\n"
            f"- {hard} hard: influence without authority, career defining moments, ambiguity/pressure situations\n"
            "All questions must be behavioral (STAR-format style). No algorithm or coding questions."
        )
        categories = '"behavioral" (all questions must use this category)'
    elif question_type == "technical":
        breakdown = (
            f"- {easy} easy: core language/framework knowledge, basic data structures\n"
            f"- {medium} medium: algorithm concepts, system design principles, debugging approach, architecture decisions\n"
            f"- {hard} hard: distributed systems, scalability trade-offs, advanced design patterns, deep technical edge cases\n"
            "All questions must be technical or system-design. No generic behavioral questions."
        )
        categories = '"technical", "system-design", or "problem-solving"'
    else:
        breakdown = (
            f"- {easy} easy: background, motivation, communication skills\n"
            f"- {medium} medium: technical concepts, past projects, problem-solving approach\n"
            f"- {hard} hard: system design concepts, deep technical, edge cases\n"
        )
        categories = '"behavioral", "technical", "system-design", or "problem-solving"'

    prompt = f"""Generate {count} interview questions for this role.

Job Description:
{session.job_description[:1000]}

Candidate Resume (background context):
{session.resume_text[:600]}

Return ONLY a valid JSON array — no markdown, no extra text:
[
  {{
    "id": "1",
    "question": "...",
    "difficulty": "easy",
    "category": "behavioral"
  }}
]

Question breakdown:
{breakdown}

Difficulty must be exactly: "easy", "medium", or "hard"
Category must be exactly: {categories}
Order them: easy → medium → hard
"""

    response = await _groq.chat.completions.create(
        model=settings.groq_main_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000,
        temperature=0.4,
        stream=False,
    )
    raw = response.choices[0].message.content or "[]"

    # Strip any accidental markdown fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)

    # Extract JSON array
    m = re.search(r"\[[\s\S]*\]", raw)
    if not m:
        return _fallback_questions()

    try:
        questions = json.loads(m.group())
        # Validate structure
        valid = []
        for i, q in enumerate(questions):
            if isinstance(q, dict) and q.get("question"):
                valid.append({
                    "id": str(q.get("id", i + 1)),
                    "question": q["question"],
                    "difficulty": q.get("difficulty", "medium"),
                    "category": q.get("category", "technical"),
                })
        return valid or _fallback_questions()
    except (json.JSONDecodeError, TypeError):
        return _fallback_questions()


def _fallback_questions() -> list[dict]:
    return [
        {"id": "1", "question": "Tell me about yourself and your background.", "difficulty": "easy", "category": "behavioral"},
        {"id": "2", "question": "Why are you interested in this role?", "difficulty": "easy", "category": "behavioral"},
        {"id": "3", "question": "Describe a challenging technical problem you solved.", "difficulty": "medium", "category": "technical"},
        {"id": "4", "question": "How do you approach system design decisions?", "difficulty": "medium", "category": "system-design"},
        {"id": "5", "question": "What is your experience with distributed systems?", "difficulty": "hard", "category": "technical"},
    ]


# ── Per-answer evaluation ────────────────────────────────────────────

_EVAL_SYSTEM = """You are a strict but constructive technical interviewer evaluating a candidate's answer.
Be specific, fair, and actionable. Keep your evaluation concise — under 250 words total."""

async def stream_evaluate_answer(
    session: Session,
    question: str,
    answer: str,
    difficulty: str,
):
    """Async generator — streams evaluation tokens for a single answer."""
    user_msg = f"""Question ({difficulty}): {question}

Candidate's Answer: {answer}

Target Role: {session.job_description[:300]}

Evaluate this answer using exactly these headers:

## Score
[X/10]

## What landed well
• [specific thing they said that was good]
• [another strength]

## What was missing
• [specific gap or missed concept]
• [improvement area]

## Ideal answer (2-3 sentences)
[What a strong answer would have included]"""

    async with _claude.messages.stream(
        model=settings.claude_sonnet_model,
        max_tokens=500,
        system=_EVAL_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text


# ── Final summary ────────────────────────────────────────────────────

_SUMMARY_SYSTEM = """You are a senior hiring manager writing a structured assessment of a mock interview.
Be honest, specific, and actionable. Focus on patterns across all answers."""

async def stream_practice_summary(session: Session, qa_pairs: list[dict]):
    """Async generator — streams the final strengths/weaknesses summary."""
    pairs_text = "\n\n".join(
        f"Q{i+1} ({p['difficulty']}): {p['question']}\n"
        f"Answer: {p['answer'][:300]}\n"
        f"Score: {p.get('score', '?')}/10"
        for i, p in enumerate(qa_pairs)
    )

    avg_score = "N/A"
    scores = [p.get("score") for p in qa_pairs if isinstance(p.get("score"), (int, float))]
    if scores:
        avg_score = f"{sum(scores)/len(scores):.1f}"

    user_msg = f"""Mock interview for: {session.job_description[:200]}

Q&A Summary:
{pairs_text}

Generate a comprehensive performance report using exactly these headers:

## Overall Score
{avg_score}/10

## Key Strengths
• [Pattern of strength across answers]
• [Another strength]
• [Another strength]

## Areas for Improvement
• [Specific gap with actionable advice]
• [Another gap]
• [Another gap]

## Verdict
[2-3 sentence hiring recommendation: Strong Hire / Hire / Maybe / Not Yet — with reasoning]

## Top 3 Study Topics Before Next Interview
1. [Specific topic]
2. [Specific topic]
3. [Specific topic]"""

    async with _claude.messages.stream(
        model=settings.claude_sonnet_model,
        max_tokens=700,
        system=_SUMMARY_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
