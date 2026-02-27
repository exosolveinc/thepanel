/**
 * LiveVoicePanel — full-page live listening tab.
 * Left: continuous Q&A stream (one answer per spoken utterance).
 * Right: code panel — shows code from the most recent answer that has it.
 *
 * Web Speech API: Chrome / Edge only. Runs entirely in its own thread,
 * does NOT touch the main chat history.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, MicOff, Loader2, Trash2, Radio, Volume2, VolumeX } from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { askQuestion } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import CodePanel from './CodePanel'

interface VoiceEntry {
  id: string
  utterance: string
  answer: string
  isStreaming: boolean
}

const HAS_CODE = (s: string) => /```\w*\n/.test(s)

export default function LiveVoicePanel() {
  const { sessionId } = useSessionStore()

  const [isRecording, setIsRecording] = useState(false)
  const [audioActive, setAudioActive] = useState(false)   // mic actually hearing sound
  const [interim, setInterim]         = useState('')
  const [entries, setEntries]         = useState<VoiceEntry[]>([])
  const [permError, setPermError]     = useState('')

  const scrollRef    = useRef<HTMLDivElement>(null)
  const recogRef     = useRef<SpeechRecognition | null>(null)
  const shouldRunRef = useRef(false)
  const sessionRef   = useRef(sessionId)

  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  // Auto-scroll answers
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries, interim])

  // Stop on unmount
  useEffect(() => () => {
    shouldRunRef.current = false
    try { recogRef.current?.abort() } catch { /* ignore */ }
  }, [])

  /* ─── Most recent entry with code ──────────────────────────── */
  const latestCodeEntry = [...entries].reverse().find(e => HAS_CODE(e.answer))
  const showCode = !!latestCodeEntry

  /* ─── LLM call per utterance ───────────────────────────────── */
  const processUtterance = useCallback((text: string) => {
    const sid = sessionRef.current
    if (!sid || !text.trim()) return
    const id = makeId()
    setEntries(prev => [...prev, { id, utterance: text, answer: '', isStreaming: true }])

    askQuestion(sid, text, 'quick', {
      onToken: tok =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, answer: e.answer + tok } : e)),
      onDone: () =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, isStreaming: false } : e)),
      onError: msg =>
        setEntries(prev => prev.map(e => e.id === id
          ? { ...e, answer: `⚠ ${msg}`, isStreaming: false } : e)),
    })
  }, [])

  /* ─── Speech recognition ───────────────────────────────────── */
  const startRecognition = useCallback(() => {
    if (!shouldRunRef.current) return

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setPermError('Speech recognition is not supported. Use Chrome or Edge.')
      shouldRunRef.current = false
      setIsRecording(false)
      return
    }

    // Abort any existing instance before creating a new one
    try { recogRef.current?.abort() } catch { /* ignore */ }

    const rec = new SR()
    rec.continuous      = true
    rec.interimResults  = true
    rec.lang            = 'en-US'
    rec.maxAlternatives = 1
    recogRef.current    = rec

    rec.onaudiostart = () => setAudioActive(true)
    rec.onaudioend   = () => setAudioActive(false)

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
      // These are non-fatal — onend will fire next and restart
      if (e.error === 'no-speech') return
      if (e.error === 'aborted')   return
      if (e.error === 'not-allowed') {
        setPermError('Microphone access denied. Click the lock icon in the address bar → allow mic.')
        shouldRunRef.current = false
        setIsRecording(false)
        return
      }
      if (e.error === 'audio-capture') {
        setPermError('No microphone found. Plug in a mic and reload.')
        shouldRunRef.current = false
        setIsRecording(false)
      }
    }

    // Chrome stops after ~60 s of silence or a network hiccup — restart automatically
    rec.onend = () => {
      setAudioActive(false)
      if (shouldRunRef.current) {
        setTimeout(startRecognition, 300)
      } else {
        setIsRecording(false)
        setInterim('')
      }
    }

    try {
      rec.start()
    } catch {
      if (shouldRunRef.current) setTimeout(startRecognition, 600)
    }
  }, [processUtterance])

  const toggleRecording = () => {
    if (isRecording) {
      shouldRunRef.current = false
      try { recogRef.current?.abort() } catch { /* ignore */ }
      setIsRecording(false)
      setInterim('')
      setAudioActive(false)
    } else {
      setPermError('')
      shouldRunRef.current = true
      setIsRecording(true)
      startRecognition()
    }
  }

  /* ─── Render ────────────────────────────────────────────────── */
  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">

      {/* ── Left: Q&A stream ── */}
      <div className={`flex flex-col overflow-hidden ${showCode ? 'w-[55%] border-r border-zinc-800/60' : 'flex-1'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-800/50 shrink-0">
          <div className="flex items-center gap-3">
            <Radio size={13} className={isRecording ? 'text-red-400' : 'text-zinc-600'} />
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">Live Listener</span>

            {isRecording && (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] text-red-400 font-medium">Recording</span>
              </div>
            )}

            {isRecording && (
              <div className="flex items-center gap-1 text-[10px]">
                {audioActive
                  ? <><Volume2 size={10} className="text-emerald-400" /><span className="text-emerald-400">Audio detected</span></>
                  : <><VolumeX size={10} className="text-zinc-600" /><span className="text-zinc-600">Waiting for speech…</span></>
                }
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {entries.length > 0 && (
              <button onClick={() => setEntries([])} title="Clear all"
                className="p-1.5 rounded-md text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors">
                <Trash2 size={12} />
              </button>
            )}
            <button
              onClick={toggleRecording}
              className={[
                'flex items-center gap-1.5 text-[11px] font-semibold px-4 py-1.5 rounded-full border transition-all',
                isRecording
                  ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25'
                  : 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/25',
              ].join(' ')}
            >
              {isRecording ? <MicOff size={12} /> : <Mic size={12} />}
              {isRecording ? 'Stop' : 'Start Listening'}
            </button>
          </div>
        </div>

        {/* Q&A stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">

          {permError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[11px] text-red-400 leading-relaxed">
              {permError}
            </div>
          )}

          {entries.length === 0 && !interim && !permError && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <Mic size={24} className="text-zinc-700" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[12px] text-zinc-400 font-medium">
                  Press <span className="text-indigo-400">Start Listening</span> then speak
                </p>
                <p className="text-[11px] text-zinc-600 max-w-[300px] leading-relaxed">
                  Each spoken sentence triggers an automatic AI answer.
                  Coding questions will show code on the right.
                </p>
              </div>
              <p className="text-[9px] text-zinc-700 border border-zinc-800 rounded-full px-3 py-1">
                Chrome / Edge only · Requires microphone permission
              </p>
            </div>
          )}

          {entries.map((entry) => (
            <div key={entry.id} className="space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="text-[9px] text-zinc-600 uppercase tracking-widest shrink-0 mt-0.5 font-semibold w-10">Heard</span>
                <p className="text-[11px] text-zinc-500 italic leading-snug">{entry.utterance}</p>
              </div>
              <div className="ml-12 bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-4 py-3">
                {entry.answer ? (
                  <div
                    className="answer-prose text-[12px] text-zinc-300 quick-answer leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.answer) }}
                  />
                ) : (
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Loader2 size={11} className="animate-spin" />
                    <span className="text-[10px]">Answering…</span>
                  </div>
                )}
                {entry.isStreaming && entry.answer && (
                  <span className="inline-block w-1.5 h-3 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            </div>
          ))}

          {interim && (
            <div className="flex items-start gap-2.5 opacity-60">
              <span className="text-[9px] text-zinc-600 uppercase tracking-widest shrink-0 mt-0.5 font-semibold w-10">Live</span>
              <p className="text-[11px] text-zinc-400 italic">
                {interim}<span className="animate-pulse ml-0.5">▋</span>
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-zinc-800/40 shrink-0">
          <p className="text-[9px] text-zinc-700">
            Each utterance → independent Groq answer · does not affect main chat
          </p>
        </div>
      </div>

      {/* ── Right: Code panel (auto-appears for coding questions) ── */}
      {showCode && (
        <div className="flex-1 overflow-hidden min-w-0">
          <CodePanel content={latestCodeEntry!.answer} />
        </div>
      )}
    </div>
  )
}
