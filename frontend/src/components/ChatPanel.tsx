import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Mic, MicOff, Loader2, Zap, Brain, Layout, FileText, ArrowDown } from 'lucide-react'
import { useSessionStore, makeId, type DesignStructure } from '../store/sessionStore'
import { askQuestion } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import clsx from 'clsx'

type AnswerMode = 'quick' | 'long' | 'design'

const TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  basic:         { label: 'Basic',         icon: <Zap size={11} />,    color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  behavioral:    { label: 'Behavioral',    icon: <Brain size={11} />,  color: 'text-sky-400 bg-sky-400/10 border-sky-400/20' },
  system_design: { label: 'System Design', icon: <Layout size={11} />, color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20' },
}

const MODE_OPTIONS: { id: AnswerMode; label: string; icon: React.ReactNode; tip: string }[] = [
  { id: 'quick',  label: 'Quick',  icon: <Zap size={12} />,      tip: 'Short answer with highlights' },
  { id: 'long',   label: 'Full',   icon: <FileText size={12} />, tip: 'TL;DR + detailed explanation' },
  { id: 'design', label: 'Design', icon: <Layout size={12} />,   tip: 'Force system design diagram' },
]

interface ChatPanelProps {
  onDesignReady: (design: DesignStructure) => void
}

export default function ChatPanel({ onDesignReady }: ChatPanelProps) {
  const { sessionId, messages, isStreaming, addMessage, appendToLastMessage, setLastMessageDesign, finalizeLastMessage, setLiveInput } =
    useSessionStore()

  const [input, setInput]       = useState('')
  const [mode, setMode]         = useState<AnswerMode>('quick')
  const [listening, setListening] = useState(false)
  const [speechError, setSpeechError] = useState('')
  const [pinToBottom, setPinToBottom] = useState(true)

  const scrollRef   = useRef<HTMLDivElement>(null)
  const recogRef    = useRef<SpeechRecognition | null>(null)

  // Smart auto-scroll: only follow if user hasn't scrolled up
  useEffect(() => {
    if (pinToBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  })

  // When streaming starts, snap to bottom
  useEffect(() => {
    if (isStreaming) {
      setPinToBottom(true)
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isStreaming])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setPinToBottom(distFromBottom < 80)
  }

  // Web Speech API
  const startListening = useCallback(() => {
    setSpeechError('')
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setSpeechError('Speech recognition not supported.'); return }
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const t = e.results[0][0].transcript
      setInput((p) => p ? p + ' ' + t : t)
      setListening(false)
    }
    rec.onerror = () => { setSpeechError('Mic error — check permissions.'); setListening(false) }
    rec.onend = () => setListening(false)
    recogRef.current = rec
    rec.start()
    setListening(true)
  }, [])

  const stopListening = useCallback(() => { recogRef.current?.stop(); setListening(false) }, [])

  const handleSend = useCallback(async () => {
    const q = input.trim()
    if (!q || !sessionId || isStreaming) return
    setInput('')
    setLiveInput('')
    setPinToBottom(true)

    addMessage({ id: makeId(), role: 'user', content: q, mode })

    const assistantId = makeId()
    addMessage({ id: assistantId, role: 'assistant', content: '', streaming: true, mode })

    let questionType = 'basic'

    await askQuestion(sessionId, q, mode, {
      onQuestionType: (type) => { questionType = type },
      onDesign: (design) => {
        setLastMessageDesign(design as DesignStructure)
        onDesignReady(design as DesignStructure)
        useSessionStore.setState((s) => {
          const m = [...s.messages]
          if (m.length > 0) m[m.length - 1] = { ...m[m.length - 1], type: 'system_design' }
          return { messages: m }
        })
      },
      onToken: (text) => appendToLastMessage(text),
      onDone: () => {
        finalizeLastMessage()
        useSessionStore.setState((s) => {
          const m = [...s.messages]
          if (m.length > 0 && !m[m.length - 1].type) {
            m[m.length - 1] = { ...m[m.length - 1], type: questionType as 'basic' | 'behavioral' | 'system_design' }
          }
          return { messages: m }
        })
      },
      onError: (msg) => {
        appendToLastMessage(`\n\n**Error:** ${msg}`)
        finalizeLastMessage()
      },
    })
  }, [input, mode, sessionId, isStreaming, addMessage, appendToLastMessage, setLastMessageDesign, finalizeLastMessage, onDesignReady])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">

      {/* ── Input area — TOP ── */}
      <div className="px-4 pt-3 pb-3 shrink-0 space-y-2 border-b border-zinc-800/60">
        {/* Mode selector */}
        <div className="flex items-center gap-1.5">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setMode(opt.id)}
              title={opt.tip}
              className={clsx(
                'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all',
                mode === opt.id
                  ? opt.id === 'design'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                    : opt.id === 'long'
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-transparent border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
          <span className="text-[10px] text-zinc-600 ml-1">
            {mode === 'quick' ? 'Key points' : mode === 'long' ? 'TL;DR + detail' : 'Force diagram'}
          </span>
        </div>

        {/* Text input */}
        {speechError && <p className="text-xs text-red-400">{speechError}</p>}
        <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-700 rounded-2xl px-3 py-2 focus-within:border-indigo-500 transition-colors">
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); setLiveInput(e.target.value) }}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? 'Answering…' : mode === 'design' ? 'Describe the system…' : 'Ask a question…'}
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
          <div className="flex items-center gap-1 pb-0.5">
            <button
              onClick={listening ? stopListening : startListening}
              disabled={isStreaming}
              title={listening ? 'Stop' : 'Capture interviewer voice'}
              className={clsx('p-1.5 rounded-lg transition-colors',
                listening ? 'text-red-400 bg-red-400/10 animate-pulse' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
                isStreaming && 'opacity-40 cursor-not-allowed',
              )}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className={clsx('p-1.5 rounded-lg transition-colors',
                input.trim() && !isStreaming ? 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-400/10' : 'text-zinc-600 cursor-not-allowed',
              )}
            >
              {isStreaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Messages — scrollable below ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative"
      >
        {messages.length === 0 && (
          <div className="flex items-start pt-6 justify-center">
            <div className="text-center space-y-3 max-w-xs">
              <p className="text-sm text-zinc-500">
                Ask anything — factual, behavioral, or system design.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {['What is Spring Boot?', 'Design a URL shortener', 'Tell me about a time you led a migration'].map((ex) => (
                  <button key={ex} onClick={() => { setInput(ex); setLiveInput(ex) }}
                    className="text-xs px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-full border border-zinc-800 transition-colors">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'user' ? (
              <div className="max-w-[85%] bg-indigo-600/90 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[96%] space-y-1">
                {/* Type + mode badges */}
                <div className="flex items-center gap-2">
                  {msg.type && (
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${TYPE_LABELS[msg.type]?.color}`}>
                      {TYPE_LABELS[msg.type]?.icon}
                      {TYPE_LABELS[msg.type]?.label}
                    </span>
                  )}
                  {msg.mode && msg.mode !== 'design' && (
                    <span className="text-[10px] text-zinc-600">{msg.mode === 'quick' ? '⚡ Quick' : '📝 Full'}</span>
                  )}
                </div>

                {/* Answer bubble */}
                <div className={clsx(
                  'bg-zinc-900 border border-zinc-800/80 rounded-2xl rounded-tl-sm px-4 py-3',
                  msg.mode === 'quick' && 'quick-answer',
                  msg.mode === 'long'  && 'long-answer',
                )}>
                  {msg.content ? (
                    <div
                      className="answer-prose text-sm text-zinc-200"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                  ) : null}
                  {msg.streaming && (
                    <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                  )}
                  {msg.design && (
                    <div className="mt-3 pt-3 border-t border-zinc-700 flex items-center gap-2 text-xs text-indigo-400">
                      <Layout size={12} />
                      <span>Design diagram loaded — explore on the right →</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div className="h-2" />

        {/* Scroll-to-bottom pill */}
        {!pinToBottom && isStreaming && (
          <div className="sticky bottom-2 flex justify-center">
            <button
              onClick={() => {
                setPinToBottom(true)
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
              }}
              className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-full shadow-lg hover:bg-indigo-500 transition-colors"
            >
              <ArrowDown size={12} /> Live answer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
