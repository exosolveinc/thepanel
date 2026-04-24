/**
 * HMTextPanel — Hiring Manager Text tab (HMT).
 * Text-based Q&A about project work. Docs are managed globally in the Docs tab.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2, Send, MessageSquare, Trash2, Zap } from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { hmAsk, getHMShortcuts } from '../api/client'
import HMAnswerCard, { type HMSection } from './HMAnswerCard'

interface QAEntry {
  id: string
  question: string
  overview: string
  flow: string
  code: string
  isStreaming: boolean
}
interface Shortcut { key: string; label: string; question: string }

export default function HMTextPanel() {
  const { sessionId } = useSessionStore()

  const [entries, setEntries]                       = useState<QAEntry[]>([])
  const [input, setInput]                           = useState('')
  const [isAsking, setIsAsking]                     = useState(false)
  const [shortcuts, setShortcuts]                   = useState<Shortcut[]>([])
  const [shortcutsLoading, setShortcutsLoading]     = useState(false)

  const qaScrollRef    = useRef<HTMLDivElement>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const abortRef       = useRef<AbortController | null>(null)
  const sessionRef     = useRef(sessionId)
  const shortcutsFetched = useRef(false)

  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  useEffect(() => {
    const el = qaScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])

  // Fetch shortcuts once on mount
  useEffect(() => {
    const sid = sessionRef.current
    if (!sid || shortcutsFetched.current) return
    shortcutsFetched.current = true
    setShortcutsLoading(true)
    getHMShortcuts(sid).then(result => {
      if (result.length > 0) setShortcuts(result)
      setShortcutsLoading(false)
    })
  }, [sessionId])

  const trimmed = input.trim().toLowerCase()
  const matchedShortcut = trimmed.length > 0
    ? (shortcuts.find(s => s.key.startsWith(trimmed)) ?? null)
    : null

  /* ─── Submit question ─────────────────────────────────────── */
  const fireQuestion = useCallback((question: string) => {
    const sid = sessionRef.current
    if (!sid || !question.trim()) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setInput('')
    setIsAsking(true)
    const id = makeId()
    setEntries(prev => [...prev, { id, question, overview: '', flow: '', code: '', isStreaming: true }])

    hmAsk(sid, question, {
      onToken: (tok, section) => setEntries(prev =>
        prev.map(e => {
          if (e.id !== id || !section) return e
          return { ...e, [section]: (e[section as HMSection] ?? '') + tok }
        })),
      onDone: () => {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, isStreaming: false } : e))
        setIsAsking(false)
      },
      onError: msg => {
        setEntries(prev => prev.map(e => e.id === id
          ? { ...e, overview: `⚠ ${msg}`, isStreaming: false } : e))
        setIsAsking(false)
      },
    }, ctrl.signal)
  }, [])

  const submitQuestion = useCallback(() => {
    if (isAsking) return
    fireQuestion(input.trim())
  }, [input, isAsking, fireQuestion])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && matchedShortcut) {
      e.preventDefault()
      setInput(matchedShortcut.question)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitQuestion()
    }
  }

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950">
        <p className="text-[11px] text-zinc-600">Create a session first (upload resume + JD on the Main tab)</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-800/50 shrink-0">
        <div className="flex items-center gap-3">
          <MessageSquare size={13} className="text-sky-400" />
          <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">HMT · Hiring Manager Text</span>
        </div>
        {entries.length > 0 && (
          <button
            onClick={() => { abortRef.current?.abort(); setEntries([]); setIsAsking(false) }}
            className="p-1.5 rounded-md text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors"
            title="Clear conversation"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Q&A stream */}
      <div ref={qaScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <MessageSquare size={16} className="text-zinc-700" />
            </div>
            <p className="text-[11px] text-zinc-600">Ask a question or use a quick shortcut below</p>
          </div>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="space-y-2">
            <div className="flex justify-end">
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-2.5 max-w-[75%]">
                <p className="text-[12px] text-zinc-300 leading-snug">{entry.question}</p>
              </div>
            </div>
            <div className="flex justify-start">
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-4 py-3 w-full max-w-[92%]">
                <HMAnswerCard
                  overview={entry.overview}
                  flow={entry.flow}
                  code={entry.code}
                  isStreaming={entry.isStreaming}
                  accent="sky"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-zinc-800/60">

        {/* Quick-ask shortcuts bar */}
        <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 overflow-x-auto scrollbar-none">
          <Zap size={10} className={shortcutsLoading ? 'text-sky-600 animate-pulse shrink-0' : 'text-zinc-600 shrink-0'} />
          {shortcutsLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 h-6 rounded-full bg-zinc-800/60 animate-pulse" style={{ width: `${52 + (i % 3) * 18}px` }} />
            ))
          ) : shortcuts.length === 0 ? (
            <span className="text-[10px] text-zinc-700 italic">No shortcuts yet — add docs in the Docs tab to generate them</span>
          ) : (
            shortcuts.map(s => {
              const isMatch = matchedShortcut?.key === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => fireQuestion(s.question)}
                  title={s.question}
                  className={[
                    'shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all whitespace-nowrap',
                    isMatch
                      ? 'bg-sky-600/25 border-sky-500/50 text-sky-300'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300',
                  ].join(' ')}
                >
                  {s.label}
                </button>
              )
            })
          )}
        </div>

        {/* Textarea + send */}
        <div className="px-4 pb-3 pt-1.5">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type a question or shortcut (stack, arch, challenges…)"
                rows={1}
                className="w-full resize-none bg-zinc-900 border border-zinc-700/70 rounded-xl px-4 py-2.5 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-sky-500/50 transition-colors min-h-[38px] max-h-[120px]"
              />
              {matchedShortcut && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                  <kbd className="text-[9px] bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-500 font-mono">Tab</kbd>
                  <span className="text-[9px] text-zinc-600">expand</span>
                </div>
              )}
            </div>
            <button
              onClick={submitQuestion}
              disabled={!input.trim() || isAsking}
              className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-sky-600/20 border border-sky-500/40 text-sky-400 hover:bg-sky-600/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {isAsking
                ? <Loader2 size={14} className="animate-spin" />
                : <Send size={14} />
              }
            </button>
          </div>
          <p className="text-[9px] text-zinc-700 mt-1.5">
            Enter to send · Shift+Enter for newline · Tab to expand shortcut
          </p>
        </div>
      </div>
    </div>
  )
}
