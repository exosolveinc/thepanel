"""Anthropic Claude async client — component drill-down and deep technical dives."""
import anthropic
from config import settings
from services.session_store import Session

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

_DRILL_SYSTEM = """You are The Panel — a principal engineer and architect helping a candidate in a technical interview.

Candidate Resume:
{resume}

Job Description:
{job_description}
{instructions_block}
The candidate is designing: {design_title}
High-level context: {design_summary}

The interviewer has asked for details on: {component_name}

IMPORTANT — Structure your response EXACTLY like this:

## Quick Take
• [Most important point — what this component IS and why it matters]
• [Key design decision or trade-off]
• [One gotcha, failure mode, or scale consideration]

---

[Full detailed analysis below. Include:]
1. Detailed architecture/internal design
2. Key technical decisions and why
3. Specific technologies/algorithms with rationale
4. Failure modes and mitigation
5. Integration with the rest of the system
6. Relevant numbers — latency, throughput, storage

Be specific. Speak as the candidate answering in an interview. Use the resume background to personalize."""

_DEEP_DRILL_SYSTEM = """You are The Panel — a distinguished engineer with deep expertise helping a candidate go very deep technically.

Candidate Resume:
{resume}

Job Description:
{job_description}
{instructions_block}
Context: Designing {design_title} → {component_name}
Sub-topic: {sub_component}

IMPORTANT — Structure your response EXACTLY like this:

## Quick Take
• [Core implementation approach in one sentence]
• [The hardest technical challenge here]
• [The trade-off you'd make and why]

---

[Go extremely deep below. Include:]
- Algorithms, data structures, exact approaches
- Pseudocode where it clarifies the concept
- Real-world examples: how Google/Netflix/Uber solve this
- Edge cases and corner cases
- Realistic implementation plan"""


def _instructions_block(session: Session) -> str:
    if session.instructions:
        return f"\nCustom Instructions from candidate:\n{session.instructions}\n"
    return ""


async def stream_drill_down(
    session: Session,
    component_name: str,
    design_title: str,
    design_summary: str,
    depth: int = 1,
    sub_component: str = "",
):
    """Async generator — streams drill-down starting with Quick Take summary then full content."""
    model = settings.claude_opus_model if depth >= 2 else settings.claude_sonnet_model

    if depth >= 2:
        system = _DEEP_DRILL_SYSTEM.format(
            resume=session.resume_text,
            job_description=session.job_description,
            instructions_block=_instructions_block(session),
            design_title=design_title,
            component_name=component_name,
            sub_component=sub_component,
        )
        user_msg = f"Deep dive on: {sub_component} within {component_name}"
    else:
        system = _DRILL_SYSTEM.format(
            resume=session.resume_text,
            job_description=session.job_description,
            instructions_block=_instructions_block(session),
            design_title=design_title,
            design_summary=design_summary,
            component_name=component_name,
        )
        user_msg = f"Deep dive on {component_name}"

    async with _client.messages.stream(
        model=model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
