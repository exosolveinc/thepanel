# The Panel — AI Interview Assistant

> Lightning-fast, real-time AI co-pilot for technical interviews. Upload your resume and job description, then ask any interview question — get structured answers, system design diagrams, code, deep reference dives, stepwise architecture breakdowns, mock interview practice with live scoring, and coding problem practice.

![Stack](https://img.shields.io/badge/Frontend-React%2019%20%2B%20Vite%20%2B%20TypeScript-blue)
![Stack](https://img.shields.io/badge/Backend-FastAPI%20%2B%20Python%203.13-green)
![LLM](https://img.shields.io/badge/LLM-Groq%20%2B%20Claude%20Sonnet%204.6-purple)

---

## Features

| Feature | Description |
|---|---|
| **Multi-mode answers** | Basic, behavioral, system design, coding — auto-detected per question |
| **System design diagrams** | Interactive Reactflow node graph of components and connections |
| **Code generation** | Coding questions auto-generate solutions in both **Python and Java** |
| **Component drill-down** | Click any node → Claude Sonnet streams a deep technical breakdown |
| **Deep Dive tab** | On-demand comprehensive reference with Mermaid diagrams per topic |
| **Architecture tab** | Stepwise architecture breakdown for system design questions with full flow diagrams |
| **Live Voice tab** | Continuous mic recording — captures spoken questions, answers automatically in 2-column layout |
| **Behavioral Practice tab** | 10 voice-based behavioral questions (STAR format, easy→hard) with per-answer scoring and a live interviewer sidebar |
| **Technical Practice tab** | 10 voice-based technical/system-design questions (easy→hard) with per-answer scoring and a live interviewer sidebar |
| **Code Practice tab** | Coding problems with an inline editor (Python/Java), hint toggle, and Claude code evaluation |
| **Focus mode** | Distraction-free overlay for reading answers during the interview |
| **Session history** | All Q&A pairs persist in session; newest answer always at top |

---

## Quick Start

### Prerequisites
- Python 3.13 (pydantic-core incompatible with 3.14+)
- Node.js 18+
- [Groq API key](https://console.groq.com) (free tier available)
- [Anthropic API key](https://console.anthropic.com)

### 1. Backend

```bash
cd backend

# Create virtual environment
python3.13 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure API keys
cp .env.example .env
# Edit .env and add your keys:
#   GROQ_API_KEY=gsk_...
#   ANTHROPIC_API_KEY=sk-ant-...

# Start the server (port 8001)
./start.sh
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** — upload your resume PDF and job description to begin.

> **Note:** Sessions are stored in-memory. If the backend restarts, click ↺ (reset) and re-upload your resume + JD to create a new session.

---

## Architecture

```
Browser (React 19 + Vite)
    │
    ├── Upload resume PDF + JD  ──►  POST /api/session
    │                                    └── pdfplumber extracts text
    │
    ├── Ask question  ────────────►  POST /api/ask  (SSE stream)
    │                                    ├── Groq llama-3.1-8b   → classify question type
    │                                    ├── Groq llama-3.3-70b  → basic / behavioral / system design
    │                                    └── Groq llama-3.3-70b  → coding (Python + Java)
    │
    ├── Drill into component  ────►  POST /api/drill  (SSE stream)
    │                                    └── Claude Sonnet 4.6  → deep component breakdown
    │
    ├── Deep Dive tab  ───────────►  POST /api/deep-dive  (SSE stream)
    │                                    └── Claude Sonnet 4.6  → 7-section reference + diagrams
    │
    ├── Architecture tab  ────────►  POST /api/arch-flow  (SSE stream)
    │                                    └── Claude Sonnet 4.6  → stepwise arch breakdown + mermaid
    │
    ├── Practice tabs  ───────────►  POST /api/practice/questions  (JSON)
    │   (Behavioral / Technical)        └── Groq llama-3.3-70b  → 10 personalized questions
    │                               POST /api/practice/evaluate   (SSE stream)
    │                                    └── Claude Sonnet 4.6  → score + feedback per answer
    │                               POST /api/practice/summary    (SSE stream)
    │                                    └── Claude Sonnet 4.6  → final performance report
    │
    └── Code Practice tab  ───────►  POST /api/code-practice/problem  (JSON)
                                         └── Groq llama-3.3-70b  → coding problem
                                     POST /api/code-practice/evaluate  (SSE stream)
                                         └── Claude Sonnet 4.6  → correctness + complexity + quality
```

### LLM Routing

| Task | Model | Notes |
|---|---|---|
| Question classification | Groq `llama-3.1-8b-instant` | ~50ms |
| Basic / behavioral answers | Groq `llama-3.3-70b-versatile` | fast streaming |
| System design (structure) | Groq `llama-3.3-70b-versatile` | JSON + narrative |
| Coding questions (Python + Java) | Groq `llama-3.3-70b-versatile` | fast streaming |
| Practice question generation | Groq `llama-3.3-70b-versatile` | JSON, non-streaming |
| Coding problem generation | Groq `llama-3.3-70b-versatile` | JSON, non-streaming |
| Component drill-down | `claude-sonnet-4-6` | high quality |
| Deep Dive reference | `claude-sonnet-4-6` | 3500 tok |
| Architecture Flow breakdown | `claude-sonnet-4-6` | 4000 tok |
| Practice answer evaluation | `claude-sonnet-4-6` | per-answer scoring |
| Practice summary report | `claude-sonnet-4-6` | final assessment |
| Code evaluation | `claude-sonnet-4-6` | correctness + complexity |

**Design principle:** Groq handles anything that needs to be fast (live interview pace). Claude handles anything that needs depth and nuance (drill-downs, evaluations, assessments).

---

## Project Structure

```
panel/
├── backend/
│   ├── main.py                        # FastAPI app, CORS, router registration
│   ├── config.py                      # Settings (API keys, model names)
│   ├── requirements.txt
│   ├── start.sh                       # Activate venv + uvicorn --reload
│   ├── routers/
│   │   ├── session.py                 # POST /api/session — resume + JD upload
│   │   ├── interview.py               # POST /api/ask — SSE Q&A stream
│   │   ├── deep_dive.py               # POST /api/deep-dive — SSE deep reference
│   │   ├── arch_flow.py               # POST /api/arch-flow — SSE architecture breakdown
│   │   ├── practice.py                # POST /api/practice/* — questions, evaluate, summary
│   │   └── code_practice.py           # POST /api/code-practice/* — problem, evaluate
│   └── services/
│       ├── session_store.py           # In-memory session registry
│       ├── pdf_parser.py              # PDF text extraction (pypdf)
│       ├── question_classifier.py     # Groq fast classification + coding keyword detection
│       ├── groq_client.py             # Basic, behavioral, system design, coding answers
│       ├── anthropic_client.py        # Component drill-down (Claude Sonnet)
│       ├── deep_dive_client.py        # Deep reference generator (Claude Sonnet)
│       ├── arch_flow_client.py        # Stepwise architecture generator (Claude Sonnet)
│       ├── practice_client.py         # Question generation (Groq) + evaluation (Claude)
│       └── code_practice_client.py    # Problem generation (Groq) + code evaluation (Claude)
│
└── frontend/
    ├── index.html
    ├── vite.config.ts                 # Proxy /api → localhost:8001
    ├── src/
    │   ├── pages/
    │   │   └── Interview.tsx          # Main layout: tabs + 3-column main view
    │   ├── components/
    │   │   ├── QueryBar.tsx           # Question input bar (text + voice)
    │   │   ├── AnswersPanel.tsx       # Scrollable Q&A history (newest first)
    │   │   ├── DesignPanel.tsx        # Reactflow system design graph
    │   │   ├── CodePanel.tsx          # Syntax-highlighted code output
    │   │   ├── DrillDrawer.tsx        # Right-side component drill-down panel
    │   │   ├── DeepDivePanel.tsx      # Deep Dive tab (TOC + Mermaid + prose)
    │   │   ├── ArchFlowPanel.tsx      # Architecture tab (stepwise + Mermaid)
    │   │   ├── LiveVoicePanel.tsx     # Continuous voice capture + auto-answer tab
    │   │   ├── PracticePanel.tsx      # Behavioral/Technical practice + live score sidebar
    │   │   ├── CodePracticePanel.tsx  # Coding problem + inline editor + evaluation
    │   │   └── CenterView.tsx         # Focus mode fullscreen overlay
    │   ├── store/
    │   │   └── sessionStore.ts        # Zustand store — all session state
    │   ├── api/
    │   │   └── client.ts              # fetch + SSE consumption helpers
    │   └── utils/
    │       └── markdown.ts            # Lightweight markdown → HTML renderer
```

---

## Tab Overview

```
[ Main ] [ Live ] [ Deep Dive ] [ Architecture ] [ Behavioral ] [ Technical ] [ Code ]
```

| Tab | Description |
|---|---|
| **Main** | 3-column layout: Q&A / system design graph / code output |
| **Live** | 2-column continuous voice capture: auto-answers utterances; code column appears when needed |
| **Deep Dive** | Comprehensive topic reference with Mermaid diagrams, cached per topic |
| **Architecture** | Stepwise architecture breakdown with Mermaid flow diagrams, cached per question |
| **Behavioral** | 10 STAR-format behavioral questions (easy→hard), voice answers, streaming evaluation, live score sidebar |
| **Technical** | 10 technical/system-design questions (easy→hard), voice answers, streaming evaluation, live score sidebar |
| **Code** | Role-tailored coding problem (easy/medium/hard), Python/Java inline editor, Claude evaluates solution |

### Practice tabs — Live Score Sidebar

Both Behavioral and Technical practice tabs include a persistent **Interviewer's View** sidebar that updates in real time:

- **Running average score** (color-coded: emerald/amber/red)
- **Verdict badge** that updates after every answer:
  - `Strong Hire` (≥8.0), `Hire` (≥6.5), `Maybe` (≥5.0), `Not Yet` (<5.0)
- **Per-question score bars** (fill in as evaluations complete)
- **Live score** extracted from the streaming evaluation as Claude writes it
- **Latest notes** — key strengths (✓) and gaps (✗) pulled from the most recent evaluation

---

## SSE Streaming Protocol

All answer endpoints return `text/event-stream`. Events:

```
event: question_type
data: {"type": "basic" | "behavioral" | "system_design"}

event: design
data: { "title": "...", "summary": "...", "components": [...], "connections": [...] }

event: token
data: {"text": "..."}

event: done
data: {}

event: error
data: {"message": "..."}
```

---

## Configuration

### Backend `.env`
```env
GROQ_API_KEY=gsk_...
ANTHROPIC_API_KEY=sk-ant-...
```

### Model overrides (optional, `config.py`)
```python
groq_fast_model: str = "llama-3.1-8b-instant"    # classification
groq_main_model: str = "llama-3.3-70b-versatile"  # Q&A + design + practice questions
claude_sonnet_model: str = "claude-sonnet-4-6"     # drill + deep dive + arch + evaluations
claude_opus_model: str = "claude-opus-4-6"         # (available for upgrades)
```

---

## Tech Stack

**Frontend**
- React 19 + Vite + TypeScript
- Tailwind CSS v4
- Zustand (state management)
- Reactflow (system design node graph)
- Mermaid.js (diagram rendering in Deep Dive + Architecture tabs)
- Lucide React (icons)
- Web Speech API (voice input — no extra keys, Chrome/Edge only)

**Backend**
- FastAPI + Uvicorn
- Pydantic v2 + pydantic-settings
- pypdf (resume parsing)
- Groq SDK (llama streaming + JSON generation)
- Anthropic SDK (Claude streaming + evaluation)
- SSE via `StreamingResponse`

---

## Development Notes

- Vite proxies `/api` → `http://localhost:8001` — no CORS issues in dev
- Backend allows all `localhost:*` origins via regex CORS middleware
- Session state is in-memory — restart clears all sessions (by design, no DB needed)
- Mermaid diagrams render only after streaming finishes (incomplete syntax won't parse mid-stream)
- Coding question detection is keyword-based (no LLM call) for zero latency overhead
- Practice question generation uses Groq with `stream=False` for reliable JSON output
- Score extraction from streaming evaluation is regex-based (`\d+/10`) — updates the sidebar live as Claude writes
