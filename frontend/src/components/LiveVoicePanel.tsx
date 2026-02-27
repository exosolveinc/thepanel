/**
 * LiveVoicePanel — continuous live listening (Otter.ai style).
 * Press Record once → stays on until you press Stop.
 * Each final utterance fires an independent quick-mode LLM call.
 * Runs entirely in its own conversation thread — does not touch main chat.
 */
import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Loader2, Trash2, Radio } from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { askQuestion } from '../api/client'
import { renderMarkdown } from '../utils/markdown'

interface VoiceEntry {
  id: string
  utterance: string
  answer: string
  isStreaming: boolean
}

export default function LiveVoicePanel() {
  const { sessionId } = useSessionStore()

  const [isRecording, setIsRecording] = useState(false)
  const [interim, setInterim]         = useState('')
  const [entries, setEntries]         = useState<VoiceEntry[]>([])
  const [permError, setPermError]     = useState('')

  const scrollRef    = useRef<HTMLDivElement>(null)
  const recogRef     = useRef<SpeechRecognition | null>(null)
  const shouldRunRef = useRef(false)   // whether we intend to keep recording
  const sessionRef   = useRef(sessionId)  // keep sessionId fresh in callbacks

  // Keep sessionRef in sync
  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries, interim])

  // Stop on unmount
  useEffect(() => () => {
    shouldRunRef.current = false
    recogRef.current?.stop()
  }, [])

  /* ─── LLM call for a single utterance ────────────────────── */

  const processUtterance = (text: string) => {
    const sid = sessionRef.current
    if (!sid || !text.trim()) return
    const id = makeId()

    setEntries(prev => [...prev, { id, utterance: text, answer: '', isStreaming: true }])

    askQuestion(sid, text, 'quick', {
      onToken: (tok) =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, answer: e.answer + tok } : e)),
      onDone: () =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, isStreaming: false } : e)),
      onError: (msg) =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, answer: `⚠ ${msg}`, isStreaming: false } : e)),
    })
  }

  /* ─── Speech recognition ──────────────────────────────────── */

  const startRecognition = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setPermError('Speech recognition is not supported in this browser. Use Chrome or Edge.')
      setIsRecording(false)
      shouldRunRef.current = false
      return
    }

    const rec = new SR()
    rec.continuous     = true
    rec.interimResults = true
    rec.lang           = 'en-US'

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interimText = ''
      let finalText   = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText   += r[0].transcript
        else           interimText += r[0].transcript
      }
      setInterim(interimText)
      if (finalText.trim()) {
        setInterim('')
        processUtterance(finalText.trim())
      }
    }

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed') {
        setPermError('Microphone access denied. Allow mic in browser settings and try again.')
        shouldRunRef.current = false
        setIsRecording(false)
      }
    }

    // Chrome stops after ~60s of silence or speech — restart if still wanted
    rec.onend = () => {
      if (shouldRunRef.current) {
        setTimeout(startRecognition, 200)
      } else {
        setIsRecording(false)
        setInterim('')
      }
    }

    try {
      rec.start()
      recogRef.current = rec
    } catch {
      // Already started — ignore
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      shouldRunRef.current = false
      recogRef.current?.stop()
      setIsRecording(false)
      setInterim('')
    } else {
      setPermError('')
      shouldRunRef.current = true
      setIsRecording(true)
      startRecognition()
    }
  }

  /* ─── render ─────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-l border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <Radio size={13} className={isRecording ? 'text-red-400' : 'text-zinc-600'} />
          <span className="text-xs font-semibold text-zinc-300">Live Listener</span>
          {isRecording && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Recording
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <button onClick={() => setEntries([])} title="Clear"
              className="text-zinc-600 hover:text-zinc-400 transition-colors p-1">
              <Trash2 size={12} />
            </button>
          )}
          <button
            onClick={toggleRecording}
            className={[
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all font-medium',
              isRecording
                ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25'
                : 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/25',
            ].join(' ')}
          >
            {isRecording ? <MicOff size={12} /> : <Mic size={12} />}
            {isRecording ? 'Stop' : 'Record'}
          </button>
        </div>
      </div>

      {/* Conversation stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Permission error */}
        {permError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-xs text-red-400">
            {permError}
          </div>
        )}

        {entries.length === 0 && !interim && !permError && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center pt-8">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Mic size={18} className="text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-600 max-w-[180px] leading-relaxed">
              Press <span className="text-indigo-400 font-medium">Record</span> then speak —
              answers stream in automatically after each sentence.
            </p>
            <p className="text-[9px] text-zinc-700">Uses device microphone · Chrome/Edge only</p>
          </div>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-[9px] text-zinc-600 uppercase tracking-widest shrink-0 mt-0.5 w-8 font-semibold">Heard</span>
              <p className="text-[11px] text-zinc-500 italic leading-relaxed">{entry.utterance}</p>
            </div>
            <div className="ml-10 bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2.5">
              {entry.answer ? (
                <div
                  className="answer-prose text-[11px] text-zinc-300 quick-answer"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.answer) }}
                />
              ) : (
                <div className="flex items-center gap-1.5 text-zinc-600">
                  <Loader2 size={11} className="animate-spin" />
                  <span className="text-[10px]">Answering…</span>
                </div>
              )}
              {entry.isStreaming && entry.answer && (
                <span className="inline-block w-1.5 h-3.5 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        ))}

        {/* Live interim */}
        {interim && (
          <div className="flex items-start gap-2 opacity-50">
            <span className="text-[9px] text-zinc-600 uppercase tracking-widest shrink-0 mt-0.5 w-8 font-semibold">Live</span>
            <p className="text-[11px] text-zinc-500 italic">
              {interim}<span className="animate-pulse ml-0.5">▋</span>
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-zinc-800/60 shrink-0">
        <p className="text-[9px] text-zinc-700">
          Each spoken phrase → auto LLM answer · independent of main chat
        </p>
      </div>
    </div>
  )
}
