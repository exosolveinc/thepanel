/**
 * DeepDivePanel — full-page deep reference view.
 * Left: table of contents (all questions asked this session).
 * Right: Claude Sonnet deep dive with Mermaid diagrams.
 * Results are cached per topic — clicking a loaded topic is instant.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { ArrowLeft, BookOpen, Loader2, ChevronRight, RefreshCw } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { requestDeepDive } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import clsx from 'clsx'

/* ── Mermaid renderer ────────────────────────────────────────────── */

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
        background:        '#09090b',
        primaryColor:      '#6366f1',
        primaryTextColor:  '#e4e4e7',
        primaryBorderColor:'#3f3f46',
        lineColor:         '#52525b',
        secondaryColor:    '#18181b',
        tertiaryColor:     '#27272a',
        edgeLabelBackground: '#18181b',
        clusterBkg:        '#18181b',
        titleColor:        '#a1a1aa',
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
    const id = `md-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
      className="my-5 flex justify-center overflow-x-auto rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4"
    />
  )
}

/* ── Content renderer — splits text / mermaid blocks ────────────── */

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
            className="deep-prose text-[13px] text-zinc-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
          />
        )
      )}
      {streaming && (
        <span className="inline-block w-1.5 h-3 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────── */

interface Props { onBack: () => void }

export default function DeepDivePanel({ onBack }: Props) {
  const { messages, sessionId, deepDives, startDeepDive, appendDeepDive, finalizeDeepDive } = useSessionStore()

  // All user questions as TOC entries
  const topics = useMemo(
    () => messages.filter(m => m.role === 'user').map(m => m.content),
    [messages],
  )

  const [activeTopic, setActiveTopic] = useState<string | null>(topics[topics.length - 1] ?? null)
  const abortRef = useRef<AbortController | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  const loadTopic = useCallback(async (topic: string) => {
    // Already loaded or loading
    if (deepDives[topic]) { setActiveTopic(topic); return }
    if (!sessionId) return

    // Cancel any in-flight request
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setActiveTopic(topic)
    startDeepDive(topic)

    await requestDeepDive(sessionId, topic, {
      onToken: text => appendDeepDive(topic, text),
      onDone:  ()   => finalizeDeepDive(topic),
      onError: msg  => { appendDeepDive(topic, `\n\n**Error:** ${msg}`); finalizeDeepDive(topic) },
    }, ctrl.signal)
  }, [sessionId, deepDives, startDeepDive, appendDeepDive, finalizeDeepDive])

  // Auto-load the active topic on mount / when tab first opens
  useEffect(() => {
    if (activeTopic) loadTopic(activeTopic)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll content to top when switching topics
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0 })
  }, [activeTopic])

  const active = activeTopic ? deepDives[activeTopic] : null

  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">

      {/* ── Left: TOC ── */}
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
          <BookOpen size={12} className="text-indigo-400" />
          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Deep Dive</span>
        </div>

        {/* Topic list */}
        <div className="flex-1 overflow-y-auto py-2">
          {topics.length === 0 && (
            <p className="text-[11px] text-zinc-700 px-4 py-3">Ask a question first.</p>
          )}
          {topics.map((topic, i) => {
            const dive = deepDives[topic]
            const isActive   = topic === activeTopic
            const isLoaded   = !!dive && !dive.streaming
            const isLoading  = !!dive && dive.streaming

            return (
              <button
                key={i}
                onClick={() => loadTopic(topic)}
                className={clsx(
                  'w-full text-left px-4 py-2.5 flex items-start gap-2.5 transition-colors group',
                  isActive
                    ? 'bg-indigo-950/40 border-r-2 border-indigo-500'
                    : 'hover:bg-zinc-900/50',
                )}
              >
                {/* Status dot */}
                <span className={clsx(
                  'shrink-0 w-1.5 h-1.5 rounded-full mt-[5px]',
                  isLoading  ? 'bg-indigo-400 animate-pulse' :
                  isLoaded   ? 'bg-emerald-500' :
                               'bg-zinc-700 group-hover:bg-zinc-500',
                )} />
                <span className={clsx(
                  'text-[11px] leading-snug',
                  isActive ? 'text-zinc-200 font-medium' : 'text-zinc-500 group-hover:text-zinc-300',
                )}>
                  {topic}
                </span>
                {!dive && (
                  <ChevronRight size={10} className="ml-auto shrink-0 text-zinc-700 group-hover:text-zinc-500 mt-0.5" />
                )}
              </button>
            )
          })}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-3 border-t border-zinc-800/40 shrink-0">
          <p className="text-[9px] text-zinc-700 leading-relaxed">
            Click any topic to generate a deep dive with diagrams via Claude.
          </p>
        </div>
      </div>

      {/* ── Right: content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Content header */}
        {activeTopic && (
          <div className="flex items-center justify-between px-8 h-12 border-b border-zinc-800/50 shrink-0 gap-4">
            <h2 className="text-[13px] font-bold text-zinc-200 truncate">{activeTopic}</h2>
            <div className="flex items-center gap-2 shrink-0">
              {active?.streaming && (
                <span className="flex items-center gap-1.5 text-[10px] text-indigo-400">
                  <Loader2 size={10} className="animate-spin" />
                  Claude is writing…
                </span>
              )}
              {active && !active.streaming && (
                <button
                  onClick={() => {
                    // Force re-fetch by clearing and reloading
                    useSessionStore.setState(s => ({
                      deepDives: { ...s.deepDives, [activeTopic]: { content: '', streaming: true } }
                    }))
                    if (sessionId) {
                      abortRef.current?.abort()
                      const ctrl = new AbortController()
                      abortRef.current = ctrl
                      requestDeepDive(sessionId, activeTopic, {
                        onToken: text => appendDeepDive(activeTopic, text),
                        onDone:  ()   => finalizeDeepDive(activeTopic),
                        onError: msg  => { appendDeepDive(activeTopic, `\n\n**Error:** ${msg}`); finalizeDeepDive(activeTopic) },
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
          {!activeTopic && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <BookOpen size={32} className="text-zinc-800" />
              <p className="text-[12px] text-zinc-700 text-center max-w-[240px] leading-relaxed">
                Select a topic from the left to generate a comprehensive deep dive.
              </p>
            </div>
          )}

          {activeTopic && !active && (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="text-indigo-500 animate-spin" />
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
