/**
 * CenterView — "Focus mode" teleprompter overlay.
 * Answer streams in the center. Question input is centered at the bottom.
 * Built for reading while speaking to an interviewer.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Minimize2, Send, Loader2, Zap, FileText, Layout } from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { askQuestion } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import clsx from 'clsx'

type AnswerMode = 'quick' | 'long' | 'design'

const MODE_OPTIONS: { id: AnswerMode; label: string; icon: React.ReactNode }[] = [
  { id: 'quick',  label: 'Quick',  icon: <Zap size={11} /> },
  { id: 'long',   label: 'Full',   icon: <FileText size={11} /> },
  { id: 'design', label: 'Design', icon: <Layout size={11} /> },
]

interface CenterViewProps {
  onClose: () => void
}

export default function CenterView({ onClose }: CenterViewProps) {
  const {
    messages, isStreaming, sessionId,
    addMessage, appendToLastMessage, setLastMessageDesign, finalizeLastMessage,
  } = useSessionStore()

  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const [input, setInput] = useState('')
  const [mode, setMode]   = useState<AnswerMode>('quick')

  // Get last assistant and user messages
  const lastAnswer   = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')

  // Follow streaming text
  useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  })

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSend = useCallback(async () => {
    const q = input.trim()
    if (!q || !sessionId || isStreaming) return
    setInput('')
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto'

    addMessage({ id: makeId(), role: 'user', content: q, mode })
    addMessage({ id: makeId(), role: 'assistant', content: '', streaming: true, mode })

    await askQuestion(sessionId, q, mode, {
      onDesign: (design) => {
        setLastMessageDesign(design as Parameters<typeof setLastMessageDesign>[0])
      },
      onToken:  (text) => appendToLastMessage(text),
      onDone:   () => finalizeLastMessage(),
      onError:  (msg) => { appendToLastMessage(`\n\n**Error:** ${msg}`); finalizeLastMessage() },
    })
  }, [input, mode, sessionId, isStreaming, addMessage, appendToLastMessage, setLastMessageDesign, finalizeLastMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/97 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/60 shrink-0">
        <span className="text-xs text-zinc-500 font-medium tracking-widest uppercase">Focus Mode</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-zinc-600">ESC to exit</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors p-1">
            <Minimize2 size={15} />
          </button>
        </div>
      </div>

      {/* Center content */}
      <div className="flex-1 flex items-center justify-center overflow-hidden py-6">
        <div className="w-full max-w-3xl px-8 flex flex-col gap-5 h-full">
          {/* Last question — shown subtly above answer */}
          {lastQuestion && (
            <div className="shrink-0">
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Question</p>
              <p className="text-zinc-400 text-base leading-relaxed">{lastQuestion.content}</p>
            </div>
          )}

          {/* Divider */}
          {lastQuestion && lastAnswer && (
            <div className="border-t border-zinc-800/60 shrink-0" />
          )}

          {/* Answer — scrollable */}
          <div ref={contentRef} className="flex-1 overflow-y-auto min-h-0">
            {!lastAnswer ? (
              <p className="text-center text-zinc-500 text-lg">Ask a question to see the answer here.</p>
            ) : (
              <div className={clsx(
                'answer-prose center-prose',
                lastAnswer.mode === 'quick' && 'quick-answer',
              )}>
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(lastAnswer.content) }} />
                {isStreaming && (
                  <span className="inline-block w-2 h-5 bg-indigo-400 animate-pulse ml-1 align-middle" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom input — centered, same width as answer */}
      <div className="shrink-0 border-t border-zinc-800/40 bg-zinc-950/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-8 py-4 space-y-2">
          {/* Mode selector + status */}
          <div className="flex items-center gap-1.5">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setMode(opt.id)}
                className={clsx(
                  'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all',
                  mode === opt.id
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                    : 'bg-transparent border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
            <span className="text-[10px] text-zinc-600 ml-auto">
              {isStreaming
                ? '⚡ Answering...'
                : lastAnswer
                  ? `${lastAnswer.type ? lastAnswer.type.replace('_', ' ') : ''} · ${lastAnswer.mode ?? 'quick'} mode`
                  : 'Enter to send · Shift+Enter for newline'}
            </span>
          </div>

          {/* Text input */}
          <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-700 rounded-2xl px-3 py-2 focus-within:border-indigo-500 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? 'Answering...' : mode === 'design' ? 'Describe the system to design...' : 'Ask a question...'}
              disabled={isStreaming}
              rows={1}
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-500 resize-none focus:outline-none py-1 max-h-32 overflow-y-auto"
              style={{ lineHeight: '1.5' }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 128) + 'px'
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className={clsx(
                'p-1.5 rounded-lg transition-colors pb-0.5',
                input.trim() && !isStreaming
                  ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-400/10'
                  : 'text-zinc-600 cursor-not-allowed',
              )}
            >
              {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
