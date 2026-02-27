/**
 * ArchFlowPanel — stepwise architecture breakdown view.
 * Left: list of questions (system design focused, but any question works).
 * Right: Claude Sonnet stepwise breakdown with Mermaid flow diagrams.
 * Results are cached per question — clicking a loaded question is instant.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { ArrowLeft, Layers, Loader2, ChevronRight, RefreshCw } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { requestArchFlow } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import clsx from 'clsx'

/* ── Mermaid renderer (shared singleton) ─────────────────────────── */

let _mermaidReady = false
let _mermaidInit: Promise<void> | null = null

async function initMermaid() {
  if (_mermaidReady) return
  if (_mermaidInit) return _mermaidInit
  _mermaidInit = import('mermaid').then(m => {
    m.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        background:         '#09090b',
        primaryColor:       '#d97706',
        primaryTextColor:   '#e4e4e7',
        primaryBorderColor: '#3f3f46',
        lineColor:          '#52525b',
        secondaryColor:     '#18181b',
        tertiaryColor:      '#27272a',
        edgeLabelBackground:'#18181b',
        clusterBkg:         '#18181b',
        titleColor:         '#a1a1aa',
      },
      flowchart: { htmlLabels: true, curve: 'basis' },
    })
    _mermaidReady = true
  })
  return _mermaidInit
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const id = `af-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    initMermaid().then(async () => {
      const { default: mermaid } = await import('mermaid')
      try {
        const { svg } = await mermaid.render(id, code.trim())
        if (ref.current) ref.current.innerHTML = svg
      } catch {
        if (ref.current) {
          ref.current.innerHTML = `<pre class="text-[10px] text-zinc-600 p-3 overflow-x-auto">${code}</pre>`
        }
      }
    })
  }, [code])

  return (
    <div
      ref={ref}
      className="my-5 flex justify-center overflow-x-auto rounded-xl border border-amber-900/30 bg-zinc-900/40 p-4"
    />
  )
}

/* ── Content renderer — splits text / mermaid blocks ─────────────── */

type Segment = { type: 'text'; content: string } | { type: 'mermaid'; content: string }

function splitSegments(content: string): Segment[] {
  const segments: Segment[] = []
  const re = /```mermaid\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(content)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: content.slice(last, m.index) })
    segments.push({ type: 'mermaid', content: m[1] })
    last = re.lastIndex
  }
  if (last < content.length) segments.push({ type: 'text', content: content.slice(last) })
  return segments
}

function ContentArea({ content, streaming }: { content: string; streaming: boolean }) {
  const segments = useMemo(() => splitSegments(content), [content])

  return (
    <div className="px-8 py-6 space-y-1">
      {segments.map((seg, i) =>
        seg.type === 'mermaid' && !streaming ? (
          <MermaidBlock key={i} code={seg.content} />
        ) : (
          <div
            key={i}
            className="arch-prose text-[13px] text-zinc-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
          />
        )
      )}
      {streaming && (
        <span className="inline-block w-1.5 h-3 bg-amber-400 animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  )
}

/* ── Main component ───────────────────────────────────────────────── */

interface Props { onBack: () => void }

export default function ArchFlowPanel({ onBack }: Props) {
  const { messages, sessionId, archFlows, startArchFlow, appendArchFlow, finalizeArchFlow } = useSessionStore()

  // All user questions — system_design ones first, then the rest
  const allQuestions = useMemo(
    () => messages.filter(m => m.role === 'user').map(m => m.content),
    [messages],
  )

  // Prefer system_design questions for default selection
  const designQuestions = useMemo(
    () => messages.filter(m => m.role === 'assistant' && m.type === 'system_design').map((_, i) => {
      const userMsgs = messages.filter(u => u.role === 'user')
      return userMsgs[i]?.content
    }).filter(Boolean) as string[],
    [messages],
  )

  const defaultQuestion = designQuestions[designQuestions.length - 1] ?? allQuestions[allQuestions.length - 1] ?? null

  const [activeQuestion, setActiveQuestion] = useState<string | null>(defaultQuestion)
  const abortRef = useRef<AbortController | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  const loadQuestion = useCallback(async (question: string) => {
    if (archFlows[question]) { setActiveQuestion(question); return }
    if (!sessionId) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setActiveQuestion(question)
    startArchFlow(question)

    await requestArchFlow(sessionId, question, {
      onToken: text => appendArchFlow(question, text),
      onDone:  ()   => finalizeArchFlow(question),
      onError: msg  => { appendArchFlow(question, `\n\n**Error:** ${msg}`); finalizeArchFlow(question) },
    }, ctrl.signal)
  }, [sessionId, archFlows, startArchFlow, appendArchFlow, finalizeArchFlow])

  // Auto-load on mount
  useEffect(() => {
    if (activeQuestion) loadQuestion(activeQuestion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll to top when switching questions
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0 })
  }, [activeQuestion])

  const active = activeQuestion ? archFlows[activeQuestion] : null

  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">

      {/* ── Left: question list ── */}
      <div className="w-[260px] shrink-0 flex flex-col border-r border-zinc-800/60 bg-zinc-950">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-zinc-800/50 shrink-0">
          <button
            onClick={onBack}
            className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
            title="Back to main view"
          >
            <ArrowLeft size={14} />
          </button>
          <Layers size={12} className="text-amber-500" />
          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Architecture</span>
        </div>

        {/* Question list */}
        <div className="flex-1 overflow-y-auto py-2">
          {allQuestions.length === 0 && (
            <p className="text-[11px] text-zinc-700 px-4 py-3">Ask a question first.</p>
          )}
          {allQuestions.map((question, i) => {
            const flow = archFlows[question]
            const isActive  = question === activeQuestion
            const isLoaded  = !!flow && !flow.streaming
            const isLoading = !!flow && flow.streaming

            return (
              <button
                key={i}
                onClick={() => loadQuestion(question)}
                className={clsx(
                  'w-full text-left px-4 py-2.5 flex items-start gap-2.5 transition-colors group',
                  isActive
                    ? 'bg-amber-950/30 border-r-2 border-amber-500'
                    : 'hover:bg-zinc-900/50',
                )}
              >
                {/* Status dot */}
                <span className={clsx(
                  'shrink-0 w-1.5 h-1.5 rounded-full mt-[5px]',
                  isLoading ? 'bg-amber-400 animate-pulse' :
                  isLoaded  ? 'bg-emerald-500' :
                              'bg-zinc-700 group-hover:bg-zinc-500',
                )} />
                <span className={clsx(
                  'text-[11px] leading-snug',
                  isActive ? 'text-zinc-200 font-medium' : 'text-zinc-500 group-hover:text-zinc-300',
                )}>
                  {question}
                </span>
                {!flow && (
                  <ChevronRight size={10} className="ml-auto shrink-0 text-zinc-700 group-hover:text-zinc-500 mt-0.5" />
                )}
              </button>
            )
          })}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-3 border-t border-zinc-800/40 shrink-0">
          <p className="text-[9px] text-zinc-700 leading-relaxed">
            Click any question to generate a stepwise architecture breakdown with diagrams.
          </p>
        </div>
      </div>

      {/* ── Right: content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Content header */}
        {activeQuestion && (
          <div className="flex items-center justify-between px-8 h-12 border-b border-zinc-800/50 shrink-0 gap-4">
            <h2 className="text-[13px] font-bold text-zinc-200 truncate">{activeQuestion}</h2>
            <div className="flex items-center gap-2 shrink-0">
              {active?.streaming && (
                <span className="flex items-center gap-1.5 text-[10px] text-amber-400">
                  <Loader2 size={10} className="animate-spin" />
                  Generating architecture…
                </span>
              )}
              {active && !active.streaming && (
                <button
                  onClick={() => {
                    useSessionStore.setState(s => ({
                      archFlows: { ...s.archFlows, [activeQuestion]: { content: '', streaming: true } }
                    }))
                    if (sessionId) {
                      abortRef.current?.abort()
                      const ctrl = new AbortController()
                      abortRef.current = ctrl
                      requestArchFlow(sessionId, activeQuestion, {
                        onToken: text => appendArchFlow(activeQuestion, text),
                        onDone:  ()   => finalizeArchFlow(activeQuestion),
                        onError: msg  => { appendArchFlow(activeQuestion, `\n\n**Error:** ${msg}`); finalizeArchFlow(activeQuestion) },
                      }, ctrl.signal)
                    }
                  }}
                  className="flex items-center gap-1 text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
                  title="Regenerate"
                >
                  <RefreshCw size={10} />
                  Refresh
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content scroll area */}
        <div ref={contentScrollRef} className="flex-1 overflow-y-auto min-h-0">
          {!activeQuestion && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Layers size={32} className="text-zinc-800" />
              <p className="text-[12px] text-zinc-700 text-center max-w-[260px] leading-relaxed">
                Select a question from the left to generate a stepwise architecture breakdown with diagrams.
              </p>
            </div>
          )}

          {activeQuestion && !active && (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="text-amber-500 animate-spin" />
            </div>
          )}

          {active && (
            <ContentArea content={active.content} streaming={active.streaming} />
          )}
        </div>
      </div>
    </div>
  )
}
