# The Panel — Architecture

## High-Level System Overview

```mermaid
flowchart TB
    subgraph Browser["Browser"]
        FE["React + Vite\n(TypeScript)"]
        MIC["Microphone\n(WebRTC)"]
    end

    subgraph Backend["FastAPI Backend (Python)"]
        API["Routers\n/api/*"]
        SS["Session Store\n(In-Memory, 12hr TTL)"]
        SVC["Services Layer"]
    end

    subgraph LLMs["LLM Providers"]
        GROQ["Groq API\n• llama-3.1-8b (fast)\n• llama-3.3-70b (main)"]
        CLAUDE["Anthropic API\n• Claude Sonnet 4.6\n• Claude Opus 4.6"]
        BEDROCK["AWS Bedrock\n• Claude Opus 4.6 (inference profile)\n• Titan Embed v2 (1024-dim)"]
    end

    subgraph Storage["Data Stores"]
        SUPA["Supabase\nPostgreSQL + pgvector\n(doc_chunks table)"]
        SQLITE["SQLite\n(project_docs — legacy)"]
    end

    DG["Deepgram\nnova-2 STT"]

    FE -->|"HTTP/SSE"| API
    MIC -->|"WebSocket\n(binary audio)"| API
    API --> SS
    API --> SVC
    SVC -->|"Async streaming"| GROQ
    SVC -->|"Async streaming"| CLAUDE
    SVC -->|"boto3 thread+queue"| BEDROCK
    SVC -->|"REST API"| SUPA
    SVC -->|"File DB"| SQLITE
    API -->|"WSS proxy"| DG
```

---

## Frontend — Tab Architecture

```mermaid
flowchart LR
    subgraph Tabs["Interview.tsx — 10 Tabs"]
        MAIN["Main\nQ&A + Design + Code"]
        LIVE["Live\nVoice STT + instant answers"]
        DEEP["Deep Dive\nTopic breakdown + Mermaid"]
        ARCH["Architecture\nStepwise system design"]
        BEH["Behavioral\nPractice + evaluation"]
        TECH["Technical\nPractice + evaluation"]
        CODE["Code\nProblems + evaluation"]
        HMV["HMV\nVoice + 3-tab answers"]
        HMT["HMT\nText + 3-tab answers"]
        DOCS["Docs\nGlobal PDF upload + RAG"]
    end

    subgraph State["Zustand Store"]
        S["sessionId\nmessages[]\ncurrentDesign\ndrillContent\nhistory (10 turns)"]
    end

    subgraph Client["api/client.ts"]
        SSE["consumeSSE()\nHandles all streaming"]
    end

    Tabs --> State
    Tabs --> Client
    Client -->|"POST + SSE"| BE["Backend /api/*"]
```

---

## Backend — Router & Endpoint Map

```mermaid
flowchart TD
    subgraph Session["session.py"]
        S1["POST /api/session\nUpload resume + JD → create session"]
    end

    subgraph Interview["interview.py"]
        I1["POST /api/ask\nClassify → stream answer (SSE)"]
        I2["POST /api/live-ask\nSkip classifier → instant stream"]
        I3["POST /api/drill\nDrill into design component"]
        I4["POST /api/follow-ups\nGenerate 3 follow-up questions"]
    end

    subgraph HM["hm.py"]
        H1["POST /api/hm/ask\n3-section parallel stream (SSE)"]
        H2["POST /api/hm/shortcuts\nGenerate quick-ask buttons"]
        H3["POST /api/hm/docs/upload\nGlobal doc → Supabase"]
        H4["GET  /api/hm/docs/list\nList global docs"]
        H5["DELETE /api/hm/docs/:id\nDelete doc + chunks"]
        H6["POST /api/hm/upload-doc\nSession-scoped upload (legacy)"]
        H7["POST /api/hm/load-doc\nLoad saved doc (legacy)"]
    end

    subgraph DeepDive["deep_dive.py"]
        D1["POST /api/deep-dive\nTopic breakdown (SSE)"]
    end

    subgraph ArchFlow["arch_flow.py"]
        A1["POST /api/arch-flow\nStepwise architecture (SSE)"]
    end

    subgraph Practice["practice.py"]
        P1["POST /api/practice/questions\nGenerate questions"]
        P2["POST /api/practice/evaluate\nEvaluate answer (SSE)"]
        P3["POST /api/practice/summary\nFinal report (SSE)"]
    end

    subgraph CodePractice["code_practice.py"]
        C1["POST /api/code-practice/problem\nGenerate coding problem"]
        C2["POST /api/code-practice/evaluate\nEvaluate code (SSE)"]
    end

    subgraph STT["stt.py"]
        ST1["WS /api/stt\nDeepgram proxy (bidirectional)"]
    end
```

---

## Model Routing

| Model | Provider | Use Cases |
|-------|----------|-----------|
| `llama-3.1-8b-instant` | Groq | Question classification, RAG query rewrite, follow-up generation |
| `llama-3.3-70b-versatile` | Groq | Main Q&A, system design (JSON + narrative), shortcuts, Mermaid flow diagrams, practice question generation, coding problem generation |
| `claude-sonnet-4-6` | Anthropic (direct) | Drill-down (depth=1), deep dives, architecture flows, practice evaluation, code evaluation |
| `claude-opus-4-6` | Anthropic (direct) | Deep drill (depth >= 2) |
| `us.anthropic.claude-opus-4-6-v1` | AWS Bedrock | HM overview section, HM code section (parallel streaming via thread+queue) |
| `amazon.titan-embed-text-v2:0` | AWS Bedrock | Document chunk embeddings (1024-dim vectors) |
| `nova-2` | Deepgram | Speech-to-text (Live + HMV voice panels) |

---

## RAG Pipeline

```mermaid
flowchart TD
    subgraph Ingest["Document Ingestion (Docs Tab)"]
        UP["Upload PDF"] --> EX["Extract Text\n(PyPDF)"]
        EX --> CH["Semantic Chunking\n~200 words/chunk\nparagraph boundaries"]
        CH --> EM["Embed Each Chunk\nBedrock Titan v2\n1024-dim vectors"]
        EM --> ST["Store in Supabase\ndoc_chunks table\n(idempotent by doc_id)"]
    end

    subgraph Query["Query Time (HMV / HMT)"]
        Q["User Question"] --> RW["Rewrite for RAG\nGroq 8b\n(standalone query from follow-up)"]
        RW --> QE["Embed Query\nBedrock Titan v2"]
        QE --> SS["Similarity Search\nmatch_doc_chunks_global()\ncosine distance, top-6"]
        SS --> CTX["Build Context\nresume + JD + top chunks"]
        CTX --> LLM["Generate Answer\nBedrock Claude Opus"]
    end

    ST -.->|"vectors stored"| SS
```

### Supabase Schema

```sql
-- Table
CREATE TABLE doc_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id      TEXT NOT NULL,
    filename    TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text  TEXT NOT NULL,
    embedding   vector(1024),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Global similarity search function
CREATE OR REPLACE FUNCTION match_doc_chunks_global(
    query_embedding vector(1024),
    match_count     int DEFAULT 6
)
RETURNS TABLE (chunk_text text, doc_id text, filename text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT dc.chunk_text, dc.doc_id, dc.filename,
           1 - (dc.embedding <=> query_embedding) AS similarity
    FROM doc_chunks dc
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

---

## HM Mode — 3-Section Parallel Streaming

```mermaid
flowchart TD
    Q["User Question"] --> RW["_rewrite_for_rag()\nGroq 8b"]
    RW --> RAG["retrieve_relevant_chunks()\nSupabase pgvector top-6"]
    RAG --> CTX["Build Context\nresume + JD + chunks + history (10 turns)"]

    CTX --> T1["Task 1: Overview\nBedrock Claude Opus\n512 tokens\nMode A (project) / Mode B (concept)"]
    CTX --> T2["Task 2: Flow\nGroq 70b\n600 tokens\nMermaid flowchart + sanitize"]
    CTX --> T3["Task 3: Code\nBedrock Claude Opus\n700 tokens\nLanguage-specific snippet"]

    T1 --> MQ["asyncio.Queue\n(tok, section) tuples"]
    T2 --> MQ
    T3 --> MQ

    MQ --> SSE["SSE Stream\nevent: token\ndata: {text, section}"]
    SSE --> FE["Frontend\n3 tabs render in parallel\nOverview | Flow | Code"]
```

---

## STT WebSocket Proxy

```mermaid
sequenceDiagram
    participant B as Browser (Mic)
    participant F as FastAPI /api/stt
    participant D as Deepgram WSS

    B->>F: WebSocket connect
    F->>D: WSS connect (Authorization: Token KEY)

    loop Audio streaming
        B->>F: Binary audio chunks (100ms intervals)
        F->>D: Forward binary audio
        D->>F: JSON transcript (interim/final)
        F->>B: Forward transcript JSON
    end

    Note over B: On speech_final → debounce 1s → flush
    Note over B: Flushed utterance → POST /api/hm/ask or /api/live-ask

    B->>F: Close
    F->>D: Close
```

---

## Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: POST /api/session\n(resume + JD)
    Created --> Active: First question asked
    Active --> Active: Questions, drills,\nuploads, practice
    Active --> Expired: 12hr TTL\n(no activity)
    Expired --> [*]: Cleaned up on\nnext create_session()

    state Active {
        [*] --> InMemory
        InMemory: Session object in dict
        InMemory: • resume_text
        InMemory: • job_description
        InMemory: • history (last 10 turns)
        InMemory: • current_design
        InMemory: • project_docs[]
        InMemory: • session_doc_ids[]
    }
```

---

## Data Flow — Main Interview Q&A

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant API as /api/ask
    participant CLS as Classifier (Groq 8b)
    participant LLM as Groq 70b / Claude

    U->>FE: Types question, clicks Send
    FE->>API: POST /api/ask {session_id, question, mode}
    API->>CLS: classify_question(question)
    CLS-->>API: "basic" / "behavioral" / "system_design"

    alt system_design
        API->>LLM: stream_system_design()
        LLM-->>API: Design JSON structure
        API-->>FE: SSE event: design {components, connections}
        LLM-->>API: Narrative tokens
        API-->>FE: SSE event: token {text}
    else basic / behavioral
        API->>LLM: stream_basic_answer(mode)
        loop Token streaming
            LLM-->>API: token
            API-->>FE: SSE event: token {text}
        end
    end

    API->>API: append_history(user + assistant)
    API-->>FE: SSE event: done
    FE->>FE: Render markdown + code blocks
```

---

## File Structure

```
thepanel/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   └── Interview.tsx          # Main page, 10-tab layout
│   │   ├── components/
│   │   │   ├── QueryBar.tsx           # Question input + mode buttons
│   │   │   ├── AnswersPanel.tsx       # Streamed Q&A display
│   │   │   ├── DesignPanel.tsx        # System design canvas
│   │   │   ├── DrillDrawer.tsx        # Component drill-down
│   │   │   ├── CodePanel.tsx          # Code viewer
│   │   │   ├── LiveVoicePanel.tsx     # STT + live answers
│   │   │   ├── DeepDivePanel.tsx      # Topic deep dive
│   │   │   ├── ArchFlowPanel.tsx      # Architecture flow
│   │   │   ├── PracticePanel.tsx      # Behavioral/technical practice
│   │   │   ├── CodePracticePanel.tsx  # Coding problems
│   │   │   ├── HMVoicePanel.tsx       # HM voice mode
│   │   │   ├── HMTextPanel.tsx        # HM text mode
│   │   │   ├── HMAnswerCard.tsx       # 3-tab answer card
│   │   │   ├── ProjectDocsPanel.tsx   # Global doc management
│   │   │   └── AudioVisualizer.tsx    # Mic visualizer
│   │   ├── api/
│   │   │   └── client.ts             # All API calls + SSE consumer
│   │   └── store/
│   │       └── sessionStore.ts        # Zustand state management
│   └── vite.config.ts                 # Dev server + proxy to :8001
│
├── backend/
│   ├── main.py                        # FastAPI app + CORS + router mounts
│   ├── config.py                      # Settings (API keys, model IDs)
│   ├── models/
│   │   └── schemas.py                 # Pydantic models
│   ├── routers/
│   │   ├── session.py                 # POST /api/session
│   │   ├── interview.py               # /ask, /live-ask, /drill, /follow-ups
│   │   ├── hm.py                      # /hm/* (hiring manager + global docs)
│   │   ├── deep_dive.py               # /deep-dive
│   │   ├── arch_flow.py               # /arch-flow
│   │   ├── practice.py                # /practice/*
│   │   ├── code_practice.py           # /code-practice/*
│   │   └── stt.py                     # WS /api/stt (Deepgram proxy)
│   └── services/
│       ├── session_store.py           # In-memory session management
│       ├── question_classifier.py     # Groq-based question classification
│       ├── groq_client.py             # Groq streaming (Q&A, design, follow-ups)
│       ├── anthropic_client.py        # Claude streaming (drill, deep dive)
│       ├── hm_client.py               # Bedrock streaming + RAG + 3-section parallel
│       ├── practice_client.py         # Practice question gen + evaluation
│       ├── code_practice_client.py    # Code problem gen + evaluation
│       ├── deep_dive_client.py        # Deep dive streaming
│       ├── arch_flow_client.py        # Architecture flow streaming
│       ├── vector_store.py            # Supabase pgvector (chunk, embed, search)
│       ├── embeddings.py              # Bedrock Titan embed wrapper
│       ├── doc_store.py               # SQLite doc persistence (legacy)
│       └── pdf_parser.py              # PyPDF text extraction
│
└── ARCHITECTURE.md                    # ← You are here
```
