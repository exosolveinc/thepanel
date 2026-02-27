"""Groq async streaming client — basic/behavioral Q&A and system design structure."""
import json
import re
from groq import AsyncGroq
from config import settings
from services.session_store import Session

_client = AsyncGroq(api_key=settings.groq_api_key)

_BASE_SYSTEM = """You are The Panel — an expert interview coach and senior engineer.
You help candidates ace technical interviews by giving sharp, confident, well-structured answers.

Candidate Resume:
{resume}

Job Description:
{job_description}

Guidelines:
- Tailor every answer to the candidate's background and the target role
- Be direct — no fluff, no filler phrases like "Great question!"
- Speak as if YOU are the candidate answering in the interview
"""

_MODE_QUICK = """
ANSWER FORMAT: QUICK MODE
Respond in this exact format (under 180 words total):

**Key Point:** [One sharp sentence — the core answer]

**Highlights:**
• **[Term]**: [1-line explanation]
• **[Term]**: [1-line explanation]
• **[Term]**: [1-line explanation]
• **[Term]**: [1-line explanation]

Bold all key technical terms inline throughout."""

_MODE_LONG = """
ANSWER FORMAT: FULL MODE
Structure your response as:

**TL;DR** — [2-3 sentence summary that stands completely alone as an answer]

---

[Full detailed explanation below. Use headers, bullet points, examples. Be thorough.]"""

_MODE_CODE = """
ANSWER FORMAT: CODING MODE
The candidate needs to explain and implement this. Structure your response as:

**Algorithm:**
[3-5 sentences explaining the approach, key insight, and how it works. **Bold every key term**.]

**How it works:**
• **[Step/Concept]**: [explanation]
• **[Step/Concept]**: [explanation]
• **[Step/Concept]**: [explanation]

**Complexity:**
• **Time**: O(...) — [brief reason]
• **Space**: O(...) — [brief reason]

**Python:**
```python
[complete, clean, commented Python implementation]
```

**Java:**
```java
[complete, clean, commented Java implementation]
```

Bold all key algorithmic terms throughout the explanation."""

_SYSTEM_DESIGN_SYSTEM = """You are The Panel — a principal-level software architect helping a candidate in a system design interview.

Candidate Resume:
{resume}

Job Description:
{job_description}

When asked to design a system, respond in TWO parts:

PART 1 — Output ONLY a raw JSON object (no markdown fences) with this exact structure:
{{
  "title": "System Name",
  "summary": "1-2 sentence high-level overview",
  "components": [
    {{
      "id": "snake_case_id",
      "name": "Human Readable Name",
      "description": "What this component does in 1 sentence",
      "tech": ["tech1", "tech2"],
      "x": 100,
      "y": 100
    }}
  ],
  "connections": [
    {{"id": "c1", "source": "component_id_1", "target": "component_id_2", "label": "optional"}}
  ]
}}

Place components at reasonable (x, y) positions: x in 50-900, y in 50-600, ~280px H / ~180px V spacing.

PART 2 — After the JSON, write a concise high-level narrative (3-5 paragraphs).

Separate with exactly: ---NARRATIVE---
"""


def _build_messages(session: Session, question: str, system: str) -> list[dict]:
    messages = [{"role": "system", "content": system}]
    messages.extend(session.history[-8:])
    messages.append({"role": "user", "content": question})
    return messages


async def stream_basic_answer(session: Session, question: str, mode: str = "quick"):
    """Async generator — yields text tokens for basic/behavioral/coding questions."""
    if mode == "code":
        mode_instruction = _MODE_CODE
    elif mode == "long":
        mode_instruction = _MODE_LONG
    else:
        mode_instruction = _MODE_QUICK

    system = _BASE_SYSTEM.format(
        resume=session.resume_text,
        job_description=session.job_description,
    ) + mode_instruction

    messages = _build_messages(session, question, system)
    max_tokens = 1400 if mode == "code" else (800 if mode == "quick" else 1500)

    stream = await _client.chat.completions.create(
        model=settings.groq_main_model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=0.3,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def stream_system_design(session: Session, question: str):
    """
    Async generator — yields ("design", json_str) then ("token", text) tuples.
    Collects full response first (JSON must be complete), then streams narrative word-by-word.
    """
    system = _SYSTEM_DESIGN_SYSTEM.format(
        resume=session.resume_text,
        job_description=session.job_description,
    )
    messages = _build_messages(session, question, system)

    full_response = ""
    stream = await _client.chat.completions.create(
        model=settings.groq_main_model,
        messages=messages,
        max_tokens=2048,
        temperature=0.3,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            full_response += delta

    # Split JSON from narrative
    if "---NARRATIVE---" in full_response:
        json_part, narrative_part = full_response.split("---NARRATIVE---", 1)
    else:
        json_part = full_response
        narrative_part = ""

    # Parse JSON — strip accidental markdown fences
    json_str = json_part.strip()
    json_str = re.sub(r"^```(?:json)?\s*", "", json_str, flags=re.MULTILINE)
    json_str = re.sub(r"\s*```\s*$", "", json_str, flags=re.MULTILINE)

    try:
        design = json.loads(json_str)
        design = _auto_layout(design)
        yield ("design", json.dumps(design))
    except json.JSONDecodeError:
        yield ("token", json_str)

    for word in narrative_part.strip().split(" "):
        if word:
            yield ("token", word + " ")


def _auto_layout(design: dict) -> dict:
    components = design.get("components", [])
    cols = 3
    gap_x, gap_y = 280, 180
    start_x, start_y = 80, 80

    for i, comp in enumerate(components):
        if not comp.get("x") and not comp.get("y"):
            row, col = divmod(i, cols)
            comp["x"] = start_x + col * gap_x
            comp["y"] = start_y + row * gap_y

    design["components"] = components
    return design
