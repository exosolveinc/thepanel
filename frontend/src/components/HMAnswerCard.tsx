/**
 * HMAnswerCard — shared answer card for HMT and HMV.
 * Shows 3 tabs: Overview · Flow (Mermaid diagram) · Code
 * All 3 sections stream in parallel; tab stays on whatever the user clicked.
 */
import { useState, useEffect, useRef } from 'react'
import { Loader2, AlignLeft, GitBranch, Code2 } from 'lucide-react'
import { renderMarkdown } from '../utils/markdown'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: { background: '#09090b', primaryColor: '#27272a', lineColor: '#52525b' },
})

export type HMSection = 'overview' | 'flow' | 'code'

function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!ref.current || !code.trim()) return
    setErr(false)
    const id = `mmd-${Math.random().toString(36).slice(2)}`
    mermaid.render(id, code.trim())
      .then(({ svg }) => { if (ref.current) ref.current.innerHTML = svg })
      .catch(() => setErr(true))
  }, [code])

  if (err) {
    return (
      <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap bg-zinc-900/60 rounded-lg p-3 overflow-x-auto">
        {code}
      </pre>
    )
  }
  return (
    <div
      ref={ref}
      className="w-full flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
    />
  )
}

interface Props {
  overview: string
  flow: string
  code: string
  isStreaming: boolean
  accent: 'sky' | 'teal'
}

const TABS: { id: HMSection; label: string; Icon: typeof AlignLeft }[] = [
  { id: 'overview', label: 'Overview', Icon: AlignLeft },
  { id: 'flow',     label: 'Flow',     Icon: GitBranch },
  { id: 'code',     label: 'Code',     Icon: Code2     },
]

export default function HMAnswerCard({ overview, flow, code, isStreaming, accent }: Props) {
  const [tab, setTab] = useState<HMSection>('overview')

  const content: Record<HMSection, string> = { overview, flow, code }

  const activeRing = accent === 'sky'
    ? 'border-sky-500/60 text-sky-300 bg-sky-500/10'
    : 'border-teal-500/60 text-teal-300 bg-teal-500/10'

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {TABS.map(({ id, label, Icon }) => {
          const active    = tab === id
          const generating = isStreaming && !content[id]
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={[
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-semibold transition-all border',
                active
                  ? activeRing
                  : 'border-transparent text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/50',
              ].join(' ')}
            >
              <Icon size={10} />
              {label}
              {generating && <Loader2 size={8} className="animate-spin opacity-60" />}
            </button>
          )
        })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        overview ? (
          <div
            className="answer-prose text-[12px] text-zinc-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(overview) }}
          />
        ) : (
          <div className="flex items-center gap-2 text-zinc-600 py-2">
            <Loader2 size={11} className="animate-spin" />
            <span className="text-[10px]">Generating overview…</span>
          </div>
        )
      )}

      {/* ── Flow diagram ── */}
      {tab === 'flow' && (
        flow && !isStreaming ? (
          <MermaidDiagram code={flow} />
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-zinc-600 py-4">
            <Loader2 size={11} className="animate-spin" />
            <span className="text-[10px]">Generating diagram…</span>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-600 italic py-2">No diagram available</p>
        )
      )}

      {/* ── Code ── */}
      {tab === 'code' && (
        code ? (
          <div
            className="answer-prose text-[12px] text-zinc-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(code) }}
          />
        ) : (
          <div className="flex items-center gap-2 text-zinc-600 py-2">
            <Loader2 size={11} className="animate-spin" />
            <span className="text-[10px]">Generating code…</span>
          </div>
        )
      )}
    </div>
  )
}
