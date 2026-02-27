/**
 * AnswersPanel — newest question always at top, right below the query bar.
 * No scroll management needed — new pairs appear at the very top.
 */
import { Zap, Brain, Layout, Code2 } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { renderMarkdown } from '../utils/markdown'
import clsx from 'clsx'

const TYPE_META: Record<string, {
  label: string; icon: React.ReactNode
  chip: string; bar: string; card: string
}> = {
  basic: {
    label: 'Basic',
    icon:  <Zap size={9} />,
    chip:  'text-amber-300 bg-amber-950/40 border-amber-700/40',
    bar:   'bg-amber-500',
    card:  'border-zinc-800/50 bg-zinc-900/50',
  },
  behavioral: {
    label: 'Behavioral',
    icon:  <Brain size={9} />,
    chip:  'text-sky-300 bg-sky-950/40 border-sky-700/40',
    bar:   'bg-sky-500',
    card:  'border-sky-900/30 bg-sky-950/10',
  },
  system_design: {
    label: 'System Design',
    icon:  <Layout size={9} />,
    chip:  'text-indigo-300 bg-indigo-950/40 border-indigo-700/40',
    bar:   'bg-indigo-500',
    card:  'border-indigo-900/40 bg-indigo-950/15',
  },
  code: {
    label: 'Code',
    icon:  <Code2 size={9} />,
    chip:  'text-emerald-300 bg-emerald-950/40 border-emerald-700/40',
    bar:   'bg-emerald-500',
    card:  'border-emerald-900/30 bg-emerald-950/10',
  },
}
const DEFAULT_META = TYPE_META.basic

/* Extract **bold** terms — exclude section headers */
function extractKeywords(content: string): string[] {
  const seen = new Set<string>()
  const kws: string[] = []
  for (const m of content.matchAll(/\*\*([^*]{2,35})\*\*/g)) {
    const t = m[1].trim()
    if (!t || seen.has(t.toLowerCase())) continue
    if (/^(tl;?dr|key point|note|important|example|summary|overview|highlights?|result|algorithm|complexity|python|java|how it works|time|space)$/i.test(t)) continue
    seen.add(t.toLowerCase())
    kws.push(t)
    if (kws.length >= 10) break
  }
  return kws
}

function usePairs() {
  const { messages } = useSessionStore()
  return messages.reduce<Array<{
    id: string; question: string; qMode?: string
    answer: string; aType?: string; aMode?: string
    streaming?: boolean; hasDesign?: boolean; keywords: string[]
  }>>((acc, m, i) => {
    if (m.role !== 'user') return acc
    const next = messages[i + 1]
    if (!next || next.role !== 'assistant') return acc
    acc.push({
      id:        m.id,
      question:  m.content,
      qMode:     m.mode,
      answer:    next.content,
      aType:     next.type,
      aMode:     next.mode,
      streaming: next.streaming,
      hasDesign: !!next.design,
      keywords:  extractKeywords(next.content),
    })
    return acc
  }, [])
}

export default function AnswersPanel() {
  const { isStreaming } = useSessionStore()
  const pairs = usePairs()

  // Newest first — pops up right below the query bar without any scrolling
  const reversed = [...pairs].reverse()

  return (
    <div className="flex flex-col h-full bg-zinc-950 min-h-0">
      {/* Header */}
      <div className="px-4 py-2 border-b border-zinc-800/50 shrink-0 flex items-center justify-between h-9">
        <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Answers</span>
        {isStreaming && (
          <span className="flex items-center gap-1 text-[8px] text-indigo-400/80">
            <span className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
            streaming
          </span>
        )}
      </div>

      {/* Scroll area — newest at top */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-6 min-h-0">
        {reversed.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-[11px] text-zinc-700 max-w-[160px] leading-relaxed">
              Ask a question above — answers appear here.
            </p>
          </div>
        )}

        {reversed.map((pair) => {
          const meta = pair.aType ? (TYPE_META[pair.aType] ?? DEFAULT_META) : DEFAULT_META
          return (
            <div key={pair.id}>
              {/* Question heading */}
              <div className="flex items-start gap-2 mb-2">
                <span className={clsx('shrink-0 w-1.5 h-1.5 rounded-full mt-[6px]', meta.bar)} />
                <p className="text-[12px] text-zinc-300 leading-snug font-semibold">{pair.question}</p>
              </div>

              {/* Answer card */}
              <div className={clsx('ml-3.5 rounded-xl border overflow-hidden', meta.card)}>

                {/* Keyword chips */}
                {pair.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 pt-2.5 pb-2 border-b border-zinc-800/40">
                    {pair.keywords.map(kw => (
                      <span key={kw} className={clsx(
                        'text-[9px] font-semibold px-1.5 py-0.5 rounded border leading-none',
                        meta.chip,
                      )}>
                        {kw}
                      </span>
                    ))}
                  </div>
                )}

                {/* Answer body */}
                <div className="px-3 py-3">
                  {pair.answer ? (
                    <div
                      className={clsx(
                        'answer-prose text-[13px] text-zinc-200 leading-relaxed',
                        pair.aMode === 'quick' && 'quick-answer',
                        pair.aMode === 'long'  && 'long-answer',
                        pair.aMode === 'code'  && 'code-answer',
                      )}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(pair.answer) }}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5 text-zinc-700 text-xs py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                      Thinking…
                    </div>
                  )}
                  {pair.streaming && pair.answer && (
                    <span className="inline-block w-1.5 h-3 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                  )}
                  {pair.hasDesign && (
                    <div className="mt-2.5 pt-2 border-t border-zinc-800/60 flex items-center gap-1.5 text-[9px] text-indigo-400/70">
                      <Layout size={9} />
                      <span>Diagram loaded in right panel</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
