"""Hiring Manager mode — 3-section PARALLEL streaming answers via Bedrock Claude Opus + RAG.

All 3 sections stream concurrently via asyncio tasks + a shared queue.
Protocol: yields (text, section_name) tuples; (None, None) signals done.
"""
import asyncio
import json
import re

import boto3
from groq import AsyncGroq

from config import settings
from services.session_store import Session
from services.vector_store import retrieve_relevant_chunks, get_docs_context_for_shortcuts
from utils.history import truncate_for_llm
from utils.logging import get_logger
from utils.retry import with_llm_retry

_groq = AsyncGroq(api_key=settings.groq_api_key)
logger = get_logger(__name__)

# ── Bedrock client ────────────────────────────────────────────────────

def _bedrock():
    return boto3.client(
        "bedrock-runtime",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )


async def _bedrock_stream(model: str, system: str, messages: list[dict], max_tokens: int):
    """Async generator yielding tokens from Bedrock Claude via thread + queue."""
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()

    @with_llm_retry()
    def _invoke():
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
        })
        return _bedrock().invoke_model_with_response_stream(
            modelId=model,
            body=body,
            contentType="application/json",
            accept="application/json",
        )

    def _run():
        try:
            resp = _invoke()
            for event in resp["body"]:
                chunk = json.loads(event["chunk"]["bytes"])
                if chunk.get("type") == "content_block_delta":
                    delta = chunk.get("delta", {})
                    if delta.get("type") == "text_delta":
                        asyncio.run_coroutine_threadsafe(q.put(delta["text"]), loop)
        except Exception as exc:
            asyncio.run_coroutine_threadsafe(q.put(exc), loop)
        finally:
            asyncio.run_coroutine_threadsafe(q.put(None), loop)

    loop.run_in_executor(None, _run)
    while True:
        try:
            item = await asyncio.wait_for(q.get(), timeout=45.0)
        except asyncio.TimeoutError:
            raise RuntimeError("Bedrock response timed out after 45s")
        if item is None:
            break
        if isinstance(item, Exception):
            raise item
        yield item


# ── Shared context block ─────────────────────────────────────────────

_CONTEXT_BLOCK = """Candidate Resume:
{resume}

Job Description:
{job_description}

Relevant Project Context:
{project_docs}
"""

# ── Section prompts ──────────────────────────────────────────────────

_OVERVIEW_SYSTEM = """You are helping a job candidate answer a hiring manager's question in real time.

{context}

There are TWO modes depending on the question type:

── MODE A: Project / experience questions ──
Questions like "how did you…", "tell me about your…", "what was your approach to…", "describe a time…"

Format:
**Bottom Line:** [1 bold sentence — the core result or capability]

• **[Keyword]:** short specific fact
• **[Keyword]:** short specific fact
(max 6 bullets)

**Impact:** [1 sentence on ownership or outcome]

Rules for Mode A:
- Use first-person: "I chose…", "I built…", "We designed…"
- ONLY use companies, metrics, tech, and outcomes that appear in the resume or project context above
- NEVER invent company names, transaction volumes, percentages, team sizes, or project details not in the context
- If the topic is NOT in the resume or project context, seamlessly switch to Mode B instead — explain the concept well. NEVER say "this is not in my resume" or "I cannot claim experience" — just explain it.
- If context lacks detail for a bullet, omit that bullet — fewer honest bullets are better than fabricated ones

── MODE B: General / conceptual questions ──
Questions like "explain X", "what is X", "how does X work", "compare X and Y", or any topic not found in the provided context

Format:
**What it is:** [1 clear sentence]

• **[Keyword]:** concise explanation
• **[Keyword]:** concise explanation
(max 6 bullets)

Rules for Mode B:
- Explain the concept clearly as a knowledgeable engineer
- Do NOT fabricate personal experience, project stories, or fake usage at specific companies
- You may relate it to the candidate's stack or role if relevant, but do not invent specifics
- NEVER refuse to answer or say "this is not in my context" — always provide a helpful explanation

── Shared rules ──
- No filler ("Great question", "Absolutely", "In my experience")
- No prose paragraphs — every line must be a bullet or a bold header"""

_FLOW_SYSTEM = """You are generating a Mermaid flowchart for a hiring manager interview answer.

{context}

Output ONLY valid Mermaid syntax. No code fences, no backticks, no explanation — just the diagram.

Start with exactly: flowchart TD

Valid arrow syntax (use ONLY these forms):
  A --> B
  A --> B --> C
  A -->|label text| B

NEVER use -->|text|> — the closing > after the label is INVALID.

Node shapes:
  A[Process Step]        rectangle
  B{{Decision?}}         diamond
  C[(Database)]          cylinder
  D([Service])           rounded

Rules:
- Maximum 8 nodes
- Labels: 2–5 words each
- For project-specific questions, only use technologies from the project context/resume. For general questions, use standard best-practice components.
- For technical questions: show components and data flow
- For behavioral questions: show Situation → Action → Result
- For process questions: show sequential workflow steps

Example of correct syntax:
flowchart TD
    A[Receive Request] --> B{{Cache Hit?}}
    B -->|Yes| C[Return Cached]
    B -->|No| D[Query Database]
    D --> E[Cache Result]
    E --> F[Return Response]"""

_CODE_SYSTEM = """You are generating a code snippet for a hiring manager interview answer.

{context}

Show the most impressive/relevant code that demonstrates the answer to the question.
- Use the correct language with syntax highlighting (```python, ```typescript, etc.)
- Include brief inline comments on key lines
- Keep it under 25 lines — focus on the core logic, not boilerplate
- For project-specific questions, only use technologies from the project context/resume. For general questions, use best-practice code freely. Never fabricate usage at specific companies.
- If the question is behavioral or non-technical, show a config file, architecture diagram as code, or CLI commands instead"""


# ── Shortcuts ────────────────────────────────────────────────────────

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
    try:
        docs_text = get_docs_context_for_shortcuts()
    except Exception:
        logger.warning("get_docs_context_for_shortcuts failed", exc_info=True)
        docs_text = "No project documents available."

    prompt = _SHORTCUTS_PROMPT.format(
        resume=(session.resume_text or "Not provided")[:3000],
        job_description=(session.job_description or "Not provided")[:1500],
        project_docs=docs_text[:6000],
    )
    response = await _groq.chat.completions.create(
        model=settings.groq_main_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1800,
        temperature=0.4,
    )
    content = response.choices[0].message.content or "[]"
    match = re.search(r"\[.*\]", content, re.DOTALL)
    try:
        return json.loads(match.group() if match else content)
    except json.JSONDecodeError:
        return []


# ── Parallel section generators ──────────────────────────────────────

async def _gen_overview(context: str, messages: list[dict]):
    async for text in _bedrock_stream(
        settings.bedrock_claude_model,
        _OVERVIEW_SYSTEM.format(context=context),
        messages,
        max_tokens=512,
    ):
        yield text


async def _gen_flow(context: str, question: str):
    async with asyncio.timeout(settings.llm_total_timeout_seconds):
        stream = await _groq.chat.completions.create(
            model=settings.groq_main_model,
            messages=[
                {"role": "system", "content": _FLOW_SYSTEM.format(context=context)},
                {"role": "user", "content": question},
            ],
            max_tokens=600,
            temperature=0.2,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


async def _gen_code(context: str, question: str):
    async for text in _bedrock_stream(
        settings.bedrock_claude_model,
        _CODE_SYSTEM.format(context=context),
        [{"role": "user", "content": question}],
        max_tokens=700,
    ):
        yield text


# ── Query rewrite for RAG ────────────────────────────────────────────

async def _rewrite_for_rag(question: str, history: list[dict]) -> str:
    """Rewrite a follow-up question into a standalone search query using Groq."""
    if not history:
        return question
    recent = truncate_for_llm(history, token_budget=1200, max_messages=4)
    convo = "\n".join(f'{m["role"]}: {m["content"][:300]}' for m in recent)
    try:
        resp = await _groq.chat.completions.create(
            model=settings.groq_fast_model,
            messages=[{
                "role": "user",
                "content": (
                    "Rewrite the FOLLOW-UP question into a standalone search query "
                    "that captures the full intent. Return ONLY the rewritten query, nothing else.\n\n"
                    f"Conversation:\n{convo}\n\nFollow-up: {question}\n\nStandalone query:"
                ),
            }],
            max_tokens=150,
            temperature=0,
        )
        rewritten = (resp.choices[0].message.content or question).strip()
        return rewritten if rewritten else question
    except Exception:
        logger.warning("_rewrite_for_rag failed; using original question", exc_info=True)
        return question


# ── Main answer generator ────────────────────────────────────────────

async def stream_hm_answer(session: Session, question: str):
    """Yields (text, section) tuples from all 3 sections concurrently.
    Sentinel (None, None) signals completion.
    """

    # Rewrite follow-up questions into standalone queries for better RAG retrieval
    rag_query = await _rewrite_for_rag(question, session.history)

    try:
        docs_text = await retrieve_relevant_chunks(rag_query, top_k=6)
        if not docs_text:
            docs_text = "No relevant project documents found. Answer based on resume and job description."
    except Exception:
        logger.warning("retrieve_relevant_chunks failed", exc_info=True)
        docs_text = "No project documents available. Answer based on resume and job description."

    context = _CONTEXT_BLOCK.format(
        resume=session.resume_text or "Not provided",
        job_description=session.job_description or "Not provided",
        project_docs=docs_text,
    )

    recent_history = truncate_for_llm(session.history)
    user_msg = [{"role": m["role"], "content": m["content"]} for m in recent_history]
    user_msg.append({"role": "user", "content": question})

    queue: asyncio.Queue = asyncio.Queue()

    def _sanitize_mermaid(text: str) -> str:
        """Fix common model mistakes in Mermaid output."""
        text = re.sub(r"^```(?:mermaid)?\s*", "", text.strip(), flags=re.MULTILINE)
        text = re.sub(r"\s*```\s*$", "", text, flags=re.MULTILINE)
        text = re.sub(r'(\|[^|]*)\|>', r'\1|', text)
        text = re.sub(r'->(\|)', r'-->\1', text)
        return text.strip()

    async def drain(name: str, gen):
        try:
            if name == "flow":
                buf = ""
                async for tok in gen:
                    buf += tok
                clean = _sanitize_mermaid(buf)
                await queue.put((clean, name))
            else:
                async for tok in gen:
                    await queue.put((tok, name))
        except Exception as exc:
            fallback = (
                f"flowchart TD\n  A[Error: {exc}]" if name == "flow"
                else f"[Error generating {name}: {exc}]"
            )
            await queue.put((fallback, name))
        finally:
            await queue.put((None, name))  # section done sentinel

    tasks = [
        asyncio.create_task(drain("overview", _gen_overview(context, user_msg))),
        asyncio.create_task(drain("flow",     _gen_flow(context, question))),
        asyncio.create_task(drain("code",     _gen_code(context, question))),
    ]

    try:
        completed = 0
        while completed < 3:
            tok, section = await queue.get()
            if tok is None:
                completed += 1
            else:
                yield (tok, section)
    finally:
        # Guarantees background tasks are cancelled even on client disconnect
        # (GeneratorExit / CancelledError raised into this generator).
        for t in tasks:
            if not t.done():
                t.cancel()

    yield (None, None)  # stream done
