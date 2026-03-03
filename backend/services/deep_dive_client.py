"""
Deep-dive content generator — Claude Sonnet produces a thorough structured
breakdown of any interview topic, complete with Mermaid diagrams.
"""
import anthropic
from config import settings
from services.session_store import Session

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

_SYSTEM = """You are a world-class technical educator and senior staff engineer helping a candidate master a topic deeply for their interview.

For the given topic produce a thorough, well-structured reference with these sections (use ## headings exactly):

## Overview
3-5 sentences: what it is, why it matters, where it sits in the tech ecosystem.

## Core Concepts
4-8 bullet points, each: **Term** — clear definition and why it matters.

## How It Works
Step-by-step explanation of the internals. Include a Mermaid diagram where useful:

```mermaid
flowchart TD
    A[Start] --> B[Step]
    B --> C{Branch?}
    C -->|Yes| D[Path A]
    C -->|No| E[Path B]
```

## Key Algorithms & Patterns
Most important algorithms, design patterns, or data structures relevant to this topic. Include Big-O where applicable.

## Real-World Usage
How it's used in production at real companies. Specific technologies, frameworks, systems.

## Interview Talking Points
• **Point**: What to say and why it impresses — 4-6 bullets.

## Common Pitfalls
• **Mistake**: What candidates typically get wrong and the correct understanding — 3-5 bullets.

Rules:
- **Bold** every key technical term on first use throughout
- Be thorough — this is a reference document, not a quick answer
- Mermaid diagrams must use valid flowchart/sequenceDiagram/classDiagram syntax
"""


async def stream_deep_dive(session: Session, topic: str):
    """Async generator — yields text tokens for a Claude deep dive on `topic`."""
    resume_snippet = (session.resume_text or "")[:400]

    instructions_note = f"Custom Instructions:\n{session.instructions[:300]}\n\n" if session.instructions else ""

    user_msg = (
        f"Generate a comprehensive deep-dive on: **{topic}**\n\n"
        f"Candidate background: {resume_snippet}\n\n"
        f"{instructions_note}"
        "Be thorough, structured, and interview-ready. "
        "Include Mermaid diagrams wherever they aid understanding."
    )

    async with _client.messages.stream(
        model=settings.claude_sonnet_model,
        max_tokens=3500,
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
