/**
 * LiveVoicePanel — live listening tab.
 *
 * Layout (left column):
 *   Header + controls
 *   Audio visualizer
 *   ── TRANSCRIPT PANEL (real-time STT, word-by-word) ──
 *   ── Q&A ANSWERS (one AI answer per utterance) ──
 *
 * STT: Deepgram nova-2 WebSocket.
 * Visualizer: Web Audio API AnalyserNode canvas.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, MicOff, Loader2, Trash2, Radio, Activity } from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { askQuestion } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import CodePanel from './CodePanel'
import AudioVisualizer from './AudioVisualizer'

const DEEPGRAM_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY as string

const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-2' +
  '&language=en-US' +
  '&smart_format=true' +
  '&interim_results=true' +
  '&utterance_end_ms=1200' +
  '&vad_events=true'

interface VoiceEntry {
  id: string
  utterance: string
  answer: string
  isStreaming: boolean
}

const HAS_CODE = (s: string) => /```\w*\n/.test(s)

export default function LiveVoicePanel() {
  const { sessionId } = useSessionStore()

  const [isRecording, setIsRecording]     = useState(false)
  const [audioActive, setAudioActive]     = useState(false)
  const [entries, setEntries]             = useState<VoiceEntry[]>([])
  const [permError, setPermError]         = useState('')
  const [analyserNode, setAnalyserNode]   = useState<AnalyserNode | null>(null)

  // Transcript state — three layers of text:
  //   transcriptLog  : completed utterances (speech_final fired)
  //   stableChunk    : is_final=true words in the current in-progress utterance
  //   interimChunk   : is_final=false words (still being predicted by Deepgram)
  const [transcriptLog, setTranscriptLog] = useState<string[]>([])
  const [stableChunk, setStableChunk]     = useState('')
  const [interimChunk, setInterimChunk]   = useState('')

  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const qaScrollRef         = useRef<HTMLDivElement>(null)
  const sessionRef          = useRef(sessionId)
  const wsRef               = useRef<WebSocket | null>(null)
  const recorderRef         = useRef<MediaRecorder | null>(null)
  const streamRef           = useRef<MediaStream | null>(null)
  const audioCtxRef         = useRef<AudioContext | null>(null)
  const finalBufRef         = useRef('')   // ref-based accumulator for is_final chunks
  const shouldRunRef        = useRef(false)
  const audioLevelRef       = useRef(0)

  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  // Auto-scroll transcript panel as words arrive
  useEffect(() => {
    const el = transcriptScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [transcriptLog, stableChunk, interimChunk])

  // Auto-scroll Q&A panel as answers stream
  useEffect(() => {
    const el = qaScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  useEffect(() => () => { stopAll() }, [])

  const latestCodeEntry = [...entries].reverse().find(e => HAS_CODE(e.answer))
  const showCode = !!latestCodeEntry

  /* ─── LLM call per utterance ──────────────────────────────── */
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

  /* ─── Audio level polling ──────────────────────────────────── */
  const startLevelPoll = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    const poll = () => {
      raf = requestAnimationFrame(poll)
      analyser.getByteFrequencyData(data)
      const max = Math.max(...data)
      audioLevelRef.current = audioLevelRef.current * 0.8 + max * 0.2
      setAudioActive(audioLevelRef.current > 18)
    }
    poll()
    return () => cancelAnimationFrame(raf)
  }, [])

  /* ─── Deepgram WebSocket ───────────────────────────────────── */
  const startListening = useCallback(async () => {
    if (!shouldRunRef.current) return
    setPermError('')
    finalBufRef.current = ''

    if (!DEEPGRAM_KEY || DEEPGRAM_KEY === 'your_deepgram_api_key_here') {
      setPermError('Add VITE_DEEPGRAM_API_KEY to frontend/.env.local and restart the dev server.')
      shouldRunRef.current = false
      setIsRecording(false)
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setPermError('Microphone access denied. Allow mic access in the browser address bar.')
      shouldRunRef.current = false
      setIsRecording(false)
      return
    }
    streamRef.current = stream

    // Web Audio — visualizer + level detection
    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx
    const source   = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize              = 128
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    setAnalyserNode(analyser)
    const stopPoll = startLevelPoll(analyser)

    const ws = new WebSocket(DEEPGRAM_URL, ['token', DEEPGRAM_KEY])
    wsRef.current = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', '']
        .find(m => !m || MediaRecorder.isTypeSupported(m)) ?? ''

      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
      }
      recorder.start(100)  // 100 ms chunks → lower latency
    }

    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'Results') {
        const alt         = (msg.channel as { alternatives: { transcript: string }[] })?.alternatives?.[0]
        const text        = alt?.transcript ?? ''
        const isFinal     = msg.is_final as boolean
        const speechFinal = msg.speech_final as boolean

        if (!isFinal) {
          // In-flight prediction — show as dim italic
          setInterimChunk(text)
        } else {
          // Locked-in chunk — add to stable buffer
          setInterimChunk('')
          if (text.trim()) {
            finalBufRef.current = (finalBufRef.current + ' ' + text).trim()
          }
          setStableChunk(finalBufRef.current)

          if (speechFinal) {
            // End of utterance — commit to log + fire LLM
            const utterance = finalBufRef.current
            finalBufRef.current = ''
            setStableChunk('')
            setInterimChunk('')
            if (utterance.trim()) {
              setTranscriptLog(prev => [...prev, utterance])
              processUtterance(utterance)
            }
          }
        }
      } else if (msg.type === 'UtteranceEnd') {
        // Long silence — flush buffer
        const utterance = finalBufRef.current
        finalBufRef.current = ''
        setStableChunk('')
        setInterimChunk('')
        if (utterance.trim()) {
          setTranscriptLog(prev => [...prev, utterance])
          processUtterance(utterance)
        }
      }
    }

    ws.onerror = () => {
      if (shouldRunRef.current)
        setPermError('Deepgram connection error. Check your API key and network.')
    }

    ws.onclose = () => {
      stopPoll()
      setAudioActive(false)
      setAnalyserNode(null)
      if (shouldRunRef.current) {
        setTimeout(startListening, 1000)
      } else {
        setIsRecording(false)
        setStableChunk('')
        setInterimChunk('')
      }
    }
  }, [processUtterance, startLevelPoll])

  /* ─── Teardown ─────────────────────────────────────────────── */
  const stopAll = useCallback(() => {
    shouldRunRef.current = false
    try { recorderRef.current?.stop() } catch { /* ignore */ }
    try { wsRef.current?.close() }      catch { /* ignore */ }
    streamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current?.close()
    recorderRef.current = null
    wsRef.current       = null
    streamRef.current   = null
    audioCtxRef.current = null
    finalBufRef.current = ''
  }, [])

  const toggleRecording = () => {
    if (isRecording) {
      stopAll()
      setIsRecording(false)
      setAudioActive(false)
      setAnalyserNode(null)
      setStableChunk('')
      setInterimChunk('')
    } else {
      setPermError('')
      shouldRunRef.current = true
      setIsRecording(true)
      startListening()
    }
  }

  const clearAll = () => {
    setEntries([])
    setTranscriptLog([])
    setStableChunk('')
    setInterimChunk('')
  }

  const hasContent = entries.length > 0 || transcriptLog.length > 0 || stableChunk || interimChunk

  /* ─── Render ────────────────────────────────────────────────── */
  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">

      {/* ── Left column ── */}
      <div className={`flex flex-col overflow-hidden ${showCode ? 'w-[55%] border-r border-zinc-800/60' : 'flex-1'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-800/50 shrink-0">
          <div className="flex items-center gap-3">
            <Radio size={13} className={isRecording ? 'text-red-400' : 'text-zinc-600'} />
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">Live Listener</span>
            {isRecording && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-red-400 font-medium">Recording</span>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  {audioActive
                    ? <><Activity size={10} className="text-emerald-400" /><span className="text-emerald-400">Audio detected</span></>
                    : <><Activity size={10} className="text-zinc-600" /><span className="text-zinc-600">Waiting for speech…</span></>
                  }
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasContent && (
              <button onClick={clearAll} title="Clear all"
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

        {/* Visualizer */}
        <div className="px-5 py-2 border-b border-zinc-800/40 shrink-0 bg-zinc-950">
          <AudioVisualizer analyser={analyserNode} active={isRecording} height={40} />
        </div>

        {/* ── Real-time transcript panel ── */}
        <div className="flex flex-col border-b border-zinc-800/50 shrink-0" style={{ height: '38%' }}>
          <div className="flex items-center justify-between px-5 py-2 border-b border-zinc-800/30">
            <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Transcript</span>
            {isRecording && (stableChunk || interimChunk) && (
              <span className="text-[9px] text-zinc-600 animate-pulse">transcribing…</span>
            )}
          </div>

          <div
            ref={transcriptScrollRef}
            className="flex-1 overflow-y-auto px-5 py-3 min-h-0"
          >
            {!isRecording && !transcriptLog.length && !stableChunk ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Mic size={18} className="text-zinc-700" />
                </div>
                <p className="text-[11px] text-zinc-500">
                  Press <span className="text-indigo-400">Start Listening</span> to begin transcription
                </p>
                <p className="text-[9px] text-zinc-700 border border-zinc-800 rounded-full px-3 py-1">
                  Deepgram nova-2 · Requires microphone permission
                </p>
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-zinc-300 font-normal">
                {/* Completed utterances */}
                {transcriptLog.map((line, i) => (
                  <span key={i} className="text-zinc-400">{line}{' '}</span>
                ))}

                {/* Locked-in words from current utterance (is_final=true) */}
                {stableChunk && (
                  <span className="text-zinc-200">{stableChunk}{' '}</span>
                )}

                {/* Live prediction (is_final=false) — dim + italic */}
                {interimChunk && (
                  <span className="text-zinc-500 italic">{interimChunk}</span>
                )}

                {/* Blinking cursor */}
                {isRecording && (
                  <span className="inline-block w-[2px] h-[14px] bg-indigo-400 animate-pulse align-middle ml-0.5" />
                )}
              </p>
            )}
          </div>
        </div>

        {/* ── Q&A answers stream ── */}
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="flex items-center px-5 py-2 border-b border-zinc-800/30 shrink-0">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">AI Answers</span>
          </div>

          <div ref={qaScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">

            {permError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[11px] text-red-400 leading-relaxed">
                {permError}
              </div>
            )}

            {entries.length === 0 && !permError && (
              <div className="flex items-center justify-center h-full">
                <p className="text-[11px] text-zinc-700">AI answers appear here after each utterance</p>
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
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-zinc-800/40 shrink-0">
          <p className="text-[9px] text-zinc-700">
            Deepgram nova-2 · Each utterance → independent Groq answer · does not affect main chat
          </p>
        </div>
      </div>

      {/* ── Right: Code panel ── */}
      {showCode && (
        <div className="flex-1 overflow-hidden min-w-0">
          <CodePanel content={latestCodeEntry!.answer} />
        </div>
      )}
    </div>
  )
}
