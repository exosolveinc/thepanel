"""
Architecture Flow generator — Claude produces a stepwise visual breakdown
of system design questions with Mermaid diagrams and per-step details.
"""
import anthropic
from config import settings
from services.session_store import Session

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

_SYSTEM = """You are a senior solutions architect helping a candidate ace system design interviews.

For the given system design question, produce a STEPWISE architecture breakdown with these sections (use ## and ### headings exactly):

## Architecture Overview
One paragraph: what the system does, key design goals, and scale assumptions.

## System Flow Diagram
A complete Mermaid flowchart covering ALL major components and their data flow:

```mermaid
flowchart TD
    Client([Client]) --> API[API Gateway]
    API --> Service[Core Service]
    Service --> DB[(Database)]
```

## Step-by-Step Breakdown

### Step 1: [Descriptive Step Name]
**What happens:** Clear explanation of this step in the request/data flow.
**Components:** Specific services used (e.g., **AWS S3**, **Apache Kafka**, **Redis**).
**Why this choice:** Rationale — why this technology over alternatives.

### Step 2: [Descriptive Step Name]
...

(Continue for ALL steps — typically 5–10 steps covering the complete flow from input to output)

## Scalability & Trade-offs
- **Horizontal scaling:** How each component scales under load.
- **Bottlenecks:** Where the system could fail or slow down.
- **Key trade-offs:** Consistency vs availability, cost vs performance, etc.

## Technology Reference
Quick-reference table of each major technology/service and its role in this architecture.

Rules:
- **Bold** every service/component name on first use
- Name specific technologies (Redis not "cache", PostgreSQL not "database", Kafka not "message queue")
- For AWS questions: use real service names (S3, Lambda, DynamoDB, SQS, Kinesis, CloudFront, RDS, ElastiCache)
- Mermaid diagrams must use valid flowchart, sequenceDiagram, or classDiagram syntax
- Steps must be numbered and follow the actual data/request flow end-to-end
- Be specific and opinionated — real architects make real choices
"""


async def stream_arch_flow(session: Session, question: str):
    """Async generator — yields text tokens for a stepwise architecture breakdown."""
    resume_snippet = (session.resume_text or "")[:300]

    instructions_note = f"Custom Instructions:\n{session.instructions[:300]}\n\n" if session.instructions else ""

    user_msg = (
        f"Generate a complete stepwise architecture breakdown for:\n\n"
        f"**{question}**\n\n"
        f"Candidate background: {resume_snippet}\n\n"
        f"{instructions_note}"
        "Show ALL steps from input to output with specific technology/AWS service choices. "
        "Include a complete Mermaid flow diagram of the entire architecture."
    )

    async with _client.messages.stream(
        model=settings.claude_sonnet_model,
        max_tokens=4000,
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
