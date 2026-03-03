/**
 * HintPanel — right of the query bar.
 *
 * Empty   → category cards (System Design / Concepts / Behavioral / Algorithm)
 * Typing  → question-type badge + topic coverage tags + streaming preview snippet
 * Q&A     → detected type badge + key terms from the answer
 */
import { useRef, useEffect } from 'react'
import { Cpu, Brain, Users, Zap } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { askQuestion } from '../api/client'
import { renderMarkdown } from '../utils/markdown'

/* ─── Question-type detector ──────────────────────────────────────── */

const QTYPES = [
  {
    test: /design|architect|scale|distribut|system|microservice|load bal/i,
    label: 'System Design', short: 'Design',
    color: {
      text: 'text-indigo-300', bg: 'bg-indigo-950/60', border: 'border-indigo-600/40',
      dot: 'bg-indigo-400', tag: 'bg-indigo-900/40 text-indigo-400 border-indigo-700/40',
    },
    topics: ['Scale', 'Availability', 'Consistency', 'APIs', 'Bottlenecks'],
  },
  {
    test: /tell me|time when|example of|describe when|give me a situation|walk me through|most challenging|conflict|leadership/i,
    label: 'Behavioral', short: 'STAR',
    color: {
      text: 'text-amber-300', bg: 'bg-amber-950/50', border: 'border-amber-600/35',
      dot: 'bg-amber-400', tag: 'bg-amber-900/30 text-amber-400 border-amber-700/40',
    },
    topics: ['Situation', 'Task', 'Action', 'Result', 'Impact'],
  },
  {
    test: /algorithm|sort|tree|graph|complex|dynamic programming|binary|recursion|implement|leetcode/i,
    label: 'Algorithms', short: 'DSA',
    color: {
      text: 'text-emerald-300', bg: 'bg-emerald-950/50', border: 'border-emerald-600/35',
      dot: 'bg-emerald-400', tag: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/40',
    },
    topics: ['Time O()', 'Space O()', 'Edge Cases', 'Optimize', 'Walk-through'],
  },
  {
    test: /explain|how does|what is|difference|compare|define|why does|when would/i,
    label: 'Concepts', short: 'Theory',
    color: {
      text: 'text-sky-300', bg: 'bg-sky-950/50', border: 'border-sky-600/35',
      dot: 'bg-sky-400', tag: 'bg-sky-900/30 text-sky-400 border-sky-700/40',
    },
    topics: ['Definition', 'Trade-offs', 'Use Cases', 'Examples', 'Internals'],
  },
]

export function detectType(text: string) {
  return QTYPES.find(q => q.test.test(text)) ?? null
}

/* ─── Category cards (empty state) ────────────────────────────────── */

const CATS = [
  {
    icon: <Cpu size={11} />,
    label: 'System Design',
    color: {
      text: 'text-indigo-400', border: 'border-indigo-700/40', bg: 'bg-indigo-950/30',
      hover: 'hover:border-indigo-600/60 hover:bg-indigo-950/50',
    },
    q: 'Design a URL shortener',
  },
  {
    icon: <Brain size={11} />,
    label: 'Concepts',
    color: {
      text: 'text-sky-400', border: 'border-sky-700/40', bg: 'bg-sky-950/30',
      hover: 'hover:border-sky-600/60 hover:bg-sky-950/50',
    },
    q: 'How does garbage collection work?',
  },
  {
    icon: <Users size={11} />,
    label: 'Behavioral',
    color: {
      text: 'text-amber-400', border: 'border-amber-700/35', bg: 'bg-amber-950/25',
      hover: 'hover:border-amber-600/55 hover:bg-amber-950/45',
    },
    q: 'Tell me about a time you led a migration',
  },
  {
    icon: <Zap size={11} />,
    label: 'Algorithm',
    color: {
      text: 'text-emerald-400', border: 'border-emerald-700/35', bg: 'bg-emerald-950/25',
      hover: 'hover:border-emerald-600/55 hover:bg-emerald-950/45',
    },
    q: 'Implement an LRU cache',
  },
]

interface HintPanelProps {
  onPrefill: (q: string) => void
}

export default function HintPanel({ onPrefill }: HintPanelProps) {
  const {
    messages, liveInputText, livePreview, isLivePreviewing,
    sessionId, appendLivePreview, clearLivePreview, setIsLivePreviewing,
  } = useSessionStore()

  const abortRef = useRef<AbortController | null>(null)
  const isTyping = liveInputText.length >= 15

  useEffect(() => {
    if (!liveInputText || liveInputText.length < 15) {
      abortRef.current?.abort(); clearLivePreview(); return
    }
    const timer = setTimeout(async () => {
      if (!sessionId) return
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      clearLivePreview(); setIsLivePreviewing(true)
      await askQuestion(sessionId, liveInputText, 'quick', {
        onToken:  t  => appendLivePreview(t),
        onDone:   () => setIsLivePreviewing(false),
        onError:  () => setIsLivePreviewing(false),
      }, abortRef.current.signal)
    }, 1800)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveInputText])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const lastAnswer = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
  const lastUser   = messages.find(m => m.role === 'user')

  /* ── Typing: streaming short answer, no tags ── */
  if (isTyping) {
    return (
      <div className="flex flex-col h-full px-4 py-2.5 gap-1 overflow-hidden">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[8.5px] text-zinc-700 uppercase tracking-widest font-bold">Quick answer</span>
          {isLivePreviewing && <span className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {livePreview ? (
            <div
              className="answer-prose text-[10.5px] text-zinc-400 leading-relaxed quick-answer"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(livePreview) }}
            />
          ) : (
            <p className="text-[10px] text-zinc-700 italic">
              {isLivePreviewing ? 'Generating…' : 'Keep typing…'}
            </p>
          )}
        </div>
      </div>
    )
  }

  /* ── After Q&A: clean text explanation of the last answer ── */
  if (lastAnswer && lastUser) {
    const cleanText = lastAnswer.content
      .replace(/\*\*/g, '')
      .replace(/#+\s*/g, '')
      .replace(/\n{2,}/g, ' · ')
      .replace(/\n/g, ' ')
      .trim()
    return (
      <div className="flex flex-col h-full px-4 py-2.5 gap-1 overflow-hidden">
        <span className="text-[8.5px] text-zinc-700 uppercase tracking-widest font-bold shrink-0">Last answer</span>
        <div className="flex-1 min-h-0 overflow-hidden">
          <p className="text-[10.5px] text-zinc-500 leading-relaxed line-clamp-4">{cleanText.slice(0, 400)}</p>
        </div>
      </div>
    )
  }

  /* ── Empty: category cards ── */
  return (
    <div className="flex items-stretch h-full px-3 py-2 gap-2 overflow-x-auto">
      {CATS.map((cat) => (
        <button
          key={cat.label}
          onClick={() => onPrefill(cat.q)}
          className={[
            'flex-1 min-w-[110px] flex flex-col justify-between rounded-xl border px-3 py-2',
            'transition-all duration-150 text-left group cursor-pointer',
            cat.color.border, cat.color.bg, cat.color.hover,
          ].join(' ')}
        >
          <div className="flex items-center gap-1.5">
            <span className={cat.color.text}>{cat.icon}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider ${cat.color.text}`}>{cat.label}</span>
          </div>
          <p className="text-[8.5px] text-zinc-600 group-hover:text-zinc-400 leading-snug mt-1.5 line-clamp-2 transition-colors">
            {cat.q}
          </p>
        </button>
      ))}
    </div>
  )
}
