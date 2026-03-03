/**
 * SituationPanel — always-visible upper context section.
 *
 * Empty   → capability showcase (what this agent does)
 * Q&A     → headline + color-coded concept cards with full descriptions
 * Design  → title + summary + component chain + chips
 *
 * Live preview has moved to HintPanel (right of the query bar).
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp, Zap, FileText, Layout, Mic, Activity } from 'lucide-react'
import { useSessionStore, type DesignStructure } from '../store/sessionStore'
import { renderMarkdown } from '../utils/markdown'

const PANEL_H = 260

/* ─── Color palette for concept cards ───────────────────────────── */

const CARD_COLORS = [
  { border: 'border-indigo-700/40',  bg: 'bg-indigo-950/30',  heading: 'text-indigo-300',  dot: 'bg-indigo-500'  },
  { border: 'border-amber-700/35',   bg: 'bg-amber-950/20',   heading: 'text-amber-300',   dot: 'bg-amber-500'   },
  { border: 'border-sky-700/35',     bg: 'bg-sky-950/20',     heading: 'text-sky-300',     dot: 'bg-sky-500'     },
  { border: 'border-emerald-700/35', bg: 'bg-emerald-950/20', heading: 'text-emerald-300', dot: 'bg-emerald-500' },
  { border: 'border-rose-700/35',    bg: 'bg-rose-950/20',    heading: 'text-rose-300',    dot: 'bg-rose-500'    },
]

/* ─── Empty state ────────────────────────────────────────────────── */

const CAPS = [
  { icon: <Zap size={15} className="text-amber-400" />,    title: 'Short Answers',     color: CARD_COLORS[1],
    desc: 'Instant bullet-point breakdowns — keyword-highlighted, recitable under pressure.' },
  { icon: <FileText size={15} className="text-sky-400" />, title: 'Full Explanations', color: CARD_COLORS[2],
    desc: 'TL;DR + deep-dive structure. Behavioral, algorithmic, or open-ended questions.' },
  { icon: <Layout size={15} className="text-indigo-400" />,title: 'System Design',     color: CARD_COLORS[0],
    desc: 'Auto-generated interactive architecture diagram. Drill into any component.' },
  { icon: <Mic size={15} className="text-rose-400" />,     title: 'Live Listener',     color: CARD_COLORS[4],
    desc: 'Leave mic running — each spoken sentence auto-triggers its own instant answer.' },
]

function EmptyState() {
  return (
    <div className="flex h-full items-stretch gap-3 px-5 py-4 overflow-x-auto">
      {CAPS.map((cap, i) => (
        <div key={cap.title}
          className={`flex-1 flex flex-col gap-2.5 rounded-xl border px-4 py-3 min-w-[140px] ${i >= 2 ? 'hidden lg:flex' : ''} ${cap.color.border} ${cap.color.bg}`}>
          <div className="flex items-center gap-2.5">
            {cap.icon}
            <span className={`text-[12px] font-bold ${cap.color.heading}`}>{cap.title}</span>
          </div>
          <p className="text-[10.5px] text-zinc-500 leading-relaxed">{cap.desc}</p>
        </div>
      ))}
    </div>
  )
}

/* ─── Concept extraction ─────────────────────────────────────────── */

interface Concept { term: string; desc: string }

export function getHeadline(content: string): string {
  const tldr = content.match(/\*\*TL;DR\*\*\s*[—–-]\s*([^\n]+)/)
  if (tldr) return tldr[1].replace(/\*\*/g, '').trim().slice(0, 140)
  const kp = content.match(/\*\*Key Point:\*\*\s*([^\n*]+)/)
  if (kp) return kp[1].trim().slice(0, 140)
  // first non-empty, non-heading line
  const first = content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('**Key'))
  return first?.replace(/\*\*/g, '').trim().slice(0, 140) ?? ''
}

function extractConcepts(content: string): Concept[] {
  const seen = new Set<string>()
  const out: Concept[] = []

  // Primary: **Term**: description
  for (const m of content.matchAll(/\*\*([^*]{2,40})\*\*[:\s–—]+([^.\n*]{15,120})/g)) {
    const term = m[1].trim(), raw = m[2].replace(/\*\*/g, '').trim()
    if (!seen.has(term.toLowerCase()) && raw.length >= 15) {
      seen.add(term.toLowerCase())
      out.push({ term, desc: raw })
      if (out.length >= 5) break
    }
  }

  // Fallback: extract bold terms without descriptions
  if (out.length < 2) {
    for (const m of content.matchAll(/\*\*([^*]{3,30})\*\*/g)) {
      const term = m[1].trim()
      if (!seen.has(term.toLowerCase())) {
        seen.add(term.toLowerCase())
        out.push({ term, desc: '' })
        if (out.length >= 4) break
      }
    }
  }

  return out
}

/* ─── Q&A concept flow — grid cards with full descriptions ──────── */

function ConceptFlow({ answer, question, typeLabel }: {
  answer: string; question: string; typeLabel: string
}) {
  const concepts = extractConcepts(answer)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: question + compact concept chips */}
      <div className="flex flex-col px-5 py-4 gap-3 overflow-hidden shrink-0" style={{ width: 'clamp(200px, 26%, 300px)' }}>
        <div className="shrink-0">
          {typeLabel && (
            <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest border border-zinc-800 rounded px-1.5 py-0.5">
              {typeLabel}
            </span>
          )}
          <p className="text-[12px] font-bold text-zinc-200 leading-snug mt-1.5">{question}</p>
        </div>
        {concepts.length > 0 && (
          <div className="flex flex-col gap-1.5 overflow-hidden">
            {concepts.map((c, i) => {
              const col = CARD_COLORS[i % CARD_COLORS.length]
              return (
                <div key={i} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${col.border} ${col.bg}`}>
                  <span className={`w-1 h-1 rounded-full shrink-0 ${col.dot}`} />
                  <p className={`text-[9.5px] font-bold leading-tight truncate ${col.heading}`}>{c.term}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px bg-zinc-800/50 my-4 shrink-0" />

      {/* Right: full rendered answer with highlights filling the space */}
      <div className="flex-1 min-w-0 px-5 py-4 overflow-hidden">
        {answer ? (
          <div
            className="answer-prose text-[10.5px] text-zinc-400 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.slice(0, 1200)) }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[10px] text-zinc-700 italic">Generating answer…</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Design context ─────────────────────────────────────────────── */

export function buildFlow(design: DesignStructure) {
  const { components: comps, connections: conns } = design
  if (!comps.length) return []
  const targeted = new Set(conns.map(c => c.target))
  const start    = comps.find(c => !targeted.has(c.id)) ?? comps[0]
  const path: Array<{ name: string; label?: string }> = [{ name: start.name }]
  const visited  = new Set([start.id])
  let cur        = start.id
  for (let i = 0; i < 6; i++) {
    const edge = conns.find(c => c.source === cur && !visited.has(c.target))
    if (!edge) break
    const next = comps.find(c => c.id === edge.target)
    if (!next) break
    path.push({ name: next.name, label: edge.label })
    visited.add(next.id); cur = next.id
  }
  return path
}

function DesignContext({ design }: { design: DesignStructure }) {
  const comps = design.components
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: title + full summary */}
      <div className="flex flex-col px-5 py-4 gap-2.5 overflow-hidden shrink-0" style={{ width: 'clamp(260px, 38%, 460px)' }}>
        <div>
          <p className="text-[13px] font-bold text-zinc-100 leading-tight">{design.title}</p>
          <p className="text-[10.5px] text-zinc-400 leading-relaxed mt-2">{design.summary}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px bg-zinc-800/50 my-4 shrink-0" />

      {/* Right: components with descriptions */}
      <div className="flex-1 min-w-0 px-4 py-4 overflow-hidden">
        <p className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest mb-3">Components</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 content-start overflow-hidden" style={{ maxHeight: 'calc(100% - 20px)' }}>
          {comps.map((c, i) => {
            const col = CARD_COLORS[i % CARD_COLORS.length]
            return (
              <div key={c.id} className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 ${col.border} ${col.bg}`}>
                <p className={`text-[10px] font-bold leading-tight ${col.heading}`}>{c.name}</p>
                {c.description && (
                  <p className="text-[9px] text-zinc-600 leading-relaxed line-clamp-2">{c.description}</p>
                )}
                {c.tech?.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {c.tech.slice(0, 3).map(t => (
                      <span key={t} className="text-[8px] font-mono text-zinc-700 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 leading-none">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ─── Main ───────────────────────────────────────────────────────── */

export default function SituationPanel() {
  const {
    messages, currentDesign, isStreaming,
  } = useSessionStore()

  const [collapsed, setCollapsed] = useState(false)

  const hasDesign  = !!currentDesign
  // Use the last user message (not first) so it reflects the current question
  const lastUser   = [...messages].reverse().find(m => m.role === 'user')
  const lastAnswer = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
  const typeLabel  = lastAnswer?.type?.replace(/_/g, ' ') ?? ''

  const mode = hasDesign ? 'design' : lastUser ? 'qa' : 'empty'
  const LABELS = { empty: 'Panel', design: 'Context', qa: 'Situation' } as const

  return (
    <div className="shrink-0 border-b border-zinc-800/60 bg-zinc-950">
      {/* Header — 28px */}
      <div
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between px-5 h-7 cursor-pointer select-none hover:bg-zinc-900/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity size={9} className="text-zinc-700" />
          <span className="text-[8.5px] font-bold text-zinc-600 uppercase tracking-widest">
            {LABELS[mode]}
          </span>
          {mode === 'design' && currentDesign && (
            <span className="text-[9px] text-zinc-700 truncate max-w-[300px]">{currentDesign.title}</span>
          )}
          {isStreaming && (
            <span className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
          )}
        </div>
        <span className="text-zinc-800">
          {collapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        </span>
      </div>

      {/* Body — fixed height */}
      {!collapsed && (
        <div className="border-t border-zinc-800/40 overflow-hidden" style={{ height: PANEL_H }}>
          {mode === 'design' ? (
            <DesignContext design={currentDesign!} />
          ) : mode === 'qa' && lastAnswer && lastUser ? (
            <ConceptFlow answer={lastAnswer.content} question={lastUser.content} typeLabel={typeLabel} />
          ) : (
            <EmptyState />
          )}
        </div>
      )}
    </div>
  )
}
