"""Hiring Manager mode — fast, project-specific streaming answers via Groq."""
import json
import re
from groq import AsyncGroq
from config import settings
from services.session_store import Session

_client = AsyncGroq(api_key=settings.groq_api_key)

_HM_SYSTEM = """You are The Panel — helping a candidate talk directly to a hiring manager about their project work.

Candidate Resume:
{resume}

Job Description:
{job_description}

Project Documents:
{project_docs}

Hiring Manager Conversation Rules:
- Answer in FIRST PERSON as the candidate — you ARE the candidate speaking
- Keep answers SHORT and DIRECT (2–4 sentences max unless the question explicitly asks for more detail)
- Always reference specific projects, tech stacks, architectural decisions, and real results from the documents above
- Lead with the most impressive or relevant fact first
- Mention WHY you chose a specific technology, not just that you used it
- If no project docs are uploaded, answer using the resume and job description only
- No buzzwords, no fluff — every sentence must contain concrete substance
- Speak confidently, like you built this and you know it inside-out
"""


_SHORTCUTS_PROMPT = """\
You are generating quick-ask shortcut buttons for a hiring manager conversation panel.

Based ONLY on the specific content in the documents below, generate 12–14 shortcuts a candidate can use to quickly ask the most relevant, impressive questions about their project work.

Rules:
- Every shortcut must be grounded in the actual documents (reference real tech, decisions, outcomes, metrics — not generic topics)
- Cover diverse angles: why tech was chosen, specific challenges solved, key architectural decisions, measurable impact, tradeoffs made, notable features built
- key: 1–3 lowercase words joined with underscores, short and memorable
- label: 2–4 words, title case, shown as a button
- question: full, specific question a hiring manager would ask — reference actual technologies/decisions/outcomes from the documents

Return ONLY a valid JSON array, no other text:
[{{"key": "...", "label": "...", "question": "..."}}, ...]

Candidate Resume (truncated):
{resume}

Job Description (truncated):
{job_description}

Project Documents:
{project_docs}
"""


async def generate_shortcuts(session: Session) -> list[dict]:
    """Generate context-aware quick-ask shortcuts from the session's documents."""
    docs_text = (
        "\n\n--- DOCUMENT BREAK ---\n\n".join(session.project_docs)
        if session.project_docs
        else "No project documents uploaded."
    )
    # Truncate to keep the prompt manageable
    prompt = _SHORTCUTS_PROMPT.format(
        resume=(session.resume_text or "Not provided")[:3000],
        job_description=(session.job_description or "Not provided")[:1500],
        project_docs=docs_text[:6000],
    )
    response = await _client.chat.completions.create(
        model=settings.groq_main_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1800,
        temperature=0.4,
    )
    content = response.choices[0].message.content or "[]"
    # Extract the JSON array, tolerating any surrounding prose
    match = re.search(r"\[.*\]", content, re.DOTALL)
    try:
        return json.loads(match.group() if match else content)
    except Exception:
        return []


async def stream_hm_answer(session: Session, question: str):
    """Async generator — yields text tokens for hiring manager mode Q&A."""
    if session.project_docs:
        docs_text = "\n\n--- DOCUMENT BREAK ---\n\n".join(session.project_docs)
    else:
        docs_text = "No project documents uploaded. Answer from resume and job description only."

    system = _HM_SYSTEM.format(
        resume=session.resume_text or "Not provided",
        job_description=session.job_description or "Not provided",
        project_docs=docs_text,
    )

    # Include recent turns for follow-up context, but keep it lightweight
    recent_history = session.history[-6:]
    messages = [{"role": "system", "content": system}]
    messages.extend(recent_history)
    messages.append({"role": "user", "content": question})

    stream = await _client.chat.completions.create(
        model=settings.groq_main_model,
        messages=messages,
        max_tokens=500,
        temperature=0.3,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
