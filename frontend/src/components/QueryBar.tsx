/**
 * QueryBar — compact search card.
 * Default: centered with max-width constraint.
 * compact=true: fills parent container (for split-row layout).
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Loader2, Zap, Layout, FileText, Search } from 'lucide-react'
import { useSessionStore, makeId, type DesignStructure } from '../store/sessionStore'
import { askQuestion } from '../api/client'
import clsx from 'clsx'

type AnswerMode = 'quick' | 'long' | 'design'

interface QueryBarProps {
  onDesignReady:  (design: DesignStructure) => void
  onClearDesign?: () => void
  prefill?:       string
  compact?:       boolean  // fills parent, no centering wrapper
}

export default function QueryBar({ onDesignReady, onClearDesign, prefill, compact }: QueryBarProps) {
  const {
    sessionId, isStreaming,
    addMessage, appendToLastMessage, setLastMessageDesign, finalizeLastMessage, setLiveInput,
  } = useSessionStore()

  const [input, setInput]           = useState('')
  const [activeMode, setActiveMode] = useState<AnswerMode | null>(null)
  const [listening, setListening]   = useState(false)
  const [speechError, setSpeechError] = useState('')

  const recogRef = useRef<SpeechRecognition | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (prefill) { setInput(prefill); setLiveInput(prefill); inputRef.current?.focus() }
  }, [prefill, setLiveInput])

  const startListening = useCallback(() => {
    setSpeechError('')
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setSpeechError('Not supported in this browser'); return }
    const rec = new SR()
    rec.continuous = false; rec.interimResults = false; rec.lang = 'en-US'
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const t = e.results[0][0].transcript
      setInput(p => p ? p + ' ' + t : t); setLiveInput(t); setListening(false)
    }
    rec.onerror = () => { setSpeechError('Mic error — check permissions'); setListening(false) }
    rec.onend   = () => setListening(false)
    recogRef.current = rec; rec.start(); setListening(true)
  }, [setLiveInput])

  const stopListening = useCallback(() => { recogRef.current?.stop(); setListening(false) }, [])

  const handleSend = useCallback(async (mode: AnswerMode) => {
    const q = input.trim()
    if (!q || !sessionId || isStreaming) return
    setInput(''); setLiveInput(''); setActiveMode(mode)
    if (mode !== 'design') { onClearDesign?.(); useSessionStore.setState({ currentDesign: null }) }

    addMessage({ id: makeId(), role: 'user', content: q, mode })
    addMessage({ id: makeId(), role: 'assistant', content: '', streaming: true, mode })

    let questionType = 'basic'
    await askQuestion(sessionId, q, mode, {
      onQuestionType: type => { questionType = type },
      onDesign: design => {
        setLastMessageDesign(design as DesignStructure)
        onDesignReady(design as DesignStructure)
        useSessionStore.setState(s => {
          const msgs = [...s.messages]
          if (msgs.length > 0) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], type: 'system_design' }
          return { messages: msgs }
        })
      },
      onToken: text => appendToLastMessage(text),
      onDone: () => {
        finalizeLastMessage(); setActiveMode(null)
        useSessionStore.setState(s => {
          const msgs = [...s.messages]
          if (msgs.length > 0 && !msgs[msgs.length - 1].type)
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], type: questionType as 'basic' | 'behavioral' | 'system_design' }
          return { messages: msgs }
        })
      },
      onError: msg => { appendToLastMessage(`\n\n**Error:** ${msg}`); finalizeLastMessage(); setActiveMode(null) },
    })
  }, [input, sessionId, isStreaming, addMessage, appendToLastMessage, setLastMessageDesign, finalizeLastMessage, onDesignReady, onClearDesign, setLiveInput])

  const canSend = !!input.trim() && !isStreaming

  const card = (
    <>
      {speechError && <p className="text-[10px] text-red-400 mb-1.5 text-center">{speechError}</p>}

      {/* Card */}
      <div className="bg-zinc-900/70 border border-zinc-700/50 rounded-2xl overflow-hidden shadow-xl shadow-black/30 focus-within:border-zinc-600/70 transition-colors">

        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
          <Search size={14} className="text-zinc-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => { setInput(e.target.value); setLiveInput(e.target.value) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend('quick') } }}
            placeholder={isStreaming ? 'Answering…' : "Type or paste the interviewer's question…"}
            disabled={isStreaming}
            autoFocus
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none"
          />
          <button
            onClick={listening ? stopListening : startListening}
            disabled={isStreaming}
            title={listening ? 'Stop' : 'Voice input'}
            className={clsx(
              'shrink-0 p-1.5 rounded-lg transition-colors',
              listening ? 'text-red-400 animate-pulse bg-red-400/10' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800',
              isStreaming && 'opacity-40 cursor-not-allowed',
            )}
          >
            {listening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-stretch divide-x divide-zinc-800/50 h-10">
          <button
            onClick={() => handleSend('quick')}
            disabled={!canSend}
            title="Short — concise bullet points"
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 text-[11px] font-semibold transition-all',
              canSend
                ? 'text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/8'
                : 'text-zinc-700 cursor-not-allowed',
              activeMode === 'quick' && 'bg-amber-500/10 text-amber-300',
            )}
          >
            {activeMode === 'quick' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            <span className="hidden sm:inline">Short Answer</span>
          </button>

          <button
            onClick={() => handleSend('long')}
            disabled={!canSend}
            title="Full — TL;DR + detailed explanation"
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 text-[11px] font-semibold transition-all',
              canSend
                ? 'text-sky-400/80 hover:text-sky-300 hover:bg-sky-500/8'
                : 'text-zinc-700 cursor-not-allowed',
              activeMode === 'long' && 'bg-sky-500/10 text-sky-300',
            )}
          >
            {activeMode === 'long' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            <span className="hidden sm:inline">Full Answer</span>
          </button>

          <button
            onClick={() => handleSend('design')}
            disabled={!canSend}
            title="Design — architecture diagram"
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 text-[11px] font-semibold transition-all',
              canSend
                ? 'text-indigo-400/80 hover:text-indigo-300 hover:bg-indigo-500/8'
                : 'text-zinc-700 cursor-not-allowed',
              activeMode === 'design' && 'bg-indigo-500/10 text-indigo-300',
            )}
          >
            {activeMode === 'design' ? <Loader2 size={12} className="animate-spin" /> : <Layout size={12} />}
            <span className="hidden sm:inline">Design</span>
          </button>
        </div>
      </div>
    </>
  )

  // compact: fills parent column directly (no centering wrapper)
  if (compact) {
    return <div className="w-full">{card}</div>
  }

  return (
    <div className="shrink-0 border-b border-zinc-800/60 bg-zinc-950 py-4 px-6 flex justify-center">
      <div className="w-full max-w-2xl">{card}</div>
    </div>
  )
}
