# The Panel — AI Interview Assistant

> Lightning-fast, real-time AI co-pilot for technical interviews. Upload your resume and job description, then ask any interview question — get structured answers, system design diagrams, code in Python + Java, deep reference dives, and stepwise architecture breakdowns.

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
| **Live Voice input** | Continuous mic recording — captures spoken questions, answers automatically |
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
    └── Architecture tab  ────────►  POST /api/arch-flow  (SSE stream)
                                         └── Claude Sonnet 4.6  → stepwise arch breakdown + mermaid
```

### LLM Routing

| Task | Model | Latency |
|---|---|---|
| Question classification | Groq `llama-3.1-8b-instant` | ~50ms |
| Basic / behavioral answers | Groq `llama-3.3-70b-versatile` | fast streaming |
| System design (structure) | Groq `llama-3.3-70b-versatile` | JSON + narrative |
| Coding questions (Python + Java) | Groq `llama-3.3-70b-versatile` | fast streaming |
| Component drill-down | `claude-sonnet-4-6` | high quality |
| Deep Dive reference | `claude-sonnet-4-6` | high quality, 3500 tok |
| Architecture Flow breakdown | `claude-sonnet-4-6` | high quality, 4000 tok |

**Design principle:** Groq handles anything that needs to be fast (live interview pace). Claude handles anything that needs to be deep (drill-downs, reference, architecture).

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
│   │   └── arch_flow.py               # POST /api/arch-flow — SSE architecture breakdown
│   └── services/
│       ├── session_store.py           # In-memory session registry
│       ├── pdf_parser.py              # PDF text extraction (pypdf)
│       ├── question_classifier.py     # Groq fast classification + coding keyword detection
│       ├── groq_client.py             # Basic, behavioral, system design, coding answers
│       ├── anthropic_client.py        # Component drill-down (Claude Sonnet)
│       ├── deep_dive_client.py        # Deep reference generator (Claude Sonnet)
│       └── arch_flow_client.py        # Stepwise architecture generator (Claude Sonnet)
│
└── frontend/
    ├── index.html
    ├── vite.config.ts                 # Proxy /api → localhost:8001
    ├── src/
    │   ├── pages/
    │   │   └── Interview.tsx          # Main layout: 3-column + tab navigation
    │   ├── components/
    │   │   ├── QueryBar.tsx           # Question input bar (text + voice)
    │   │   ├── AnswersPanel.tsx       # Scrollable Q&A history (newest first)
    │   │   ├── DesignPanel.tsx        # Reactflow system design graph
    │   │   ├── CodePanel.tsx          # Syntax-highlighted code output
    │   │   ├── DrillDrawer.tsx        # Right-side component drill-down panel
    │   │   ├── DeepDivePanel.tsx      # Deep Dive tab (TOC + Mermaid + prose)
    │   │   ├── ArchFlowPanel.tsx      # Architecture tab (stepwise + Mermaid)
    │   │   ├── LiveVoicePanel.tsx     # Continuous voice capture panel
    │   │   └── CenterView.tsx         # Focus mode fullscreen overlay
    │   ├── store/
    │   │   └── sessionStore.ts        # Zustand store — all session state
    │   ├── api/
    │   │   └── client.ts              # fetch + SSE consumption helpers
    │   └── utils/
    │       └── markdown.ts            # Lightweight markdown → HTML renderer
```

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

## UI Overview

### Main view (3 columns)
```
┌─────────────────┬──────────────────┬──────────────────┐
│  Query bar      │  System Design   │  Code output     │
│  ─────────────  │  Reactflow graph │  (when coding    │
│  Q&A history    │  (when design    │   question asked) │
│  (newest first) │   question asked)│                  │
└─────────────────┴──────────────────┴──────────────────┘
```

### Tabs (header)
- **Main** — 3-column Q&A / design / code view
- **Deep Dive** — Comprehensive topic reference with Mermaid diagrams (Claude, cached)
- **Architecture** — Stepwise architecture breakdown for any design question (Claude, cached)

### Right-side panels (overlays in main view)
- **Drill panel** — Click a Reactflow node → full technical deep dive streams in
- **Voice panel** — Toggle mic → continuous listening → auto-answers each utterance

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
groq_main_model: str = "llama-3.3-70b-versatile"  # Q&A + design
claude_sonnet_model: str = "claude-sonnet-4-6"     # drill + deep dive + arch
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
- Web Speech API (voice input, no extra keys)

**Backend**
- FastAPI + Uvicorn
- Pydantic v2 + pydantic-settings
- pypdf (resume parsing)
- Groq SDK (llama streaming)
- Anthropic SDK (Claude streaming)
- SSE via `StreamingResponse`

---

## Development Notes

- Vite proxies `/api` → `http://localhost:8001` — no CORS issues in dev
- Backend allows all `localhost:*` origins via regex CORS middleware
- Session state is in-memory (restart clears sessions)
- Mermaid diagrams render only after streaming finishes (incomplete syntax won't parse mid-stream)
- Coding question detection is keyword-based (no LLM call) for zero latency overhead
