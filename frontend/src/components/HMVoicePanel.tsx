/**
 * HMVoicePanel — Hiring Manager Voice tab (HMV).
 * Speaks about project work to a hiring manager using Deepgram STT.
 * Reuses the same Deepgram WebSocket + intelligent debounce as LiveVoicePanel,
 * but routes through /api/hm/ask with a project-aware system prompt.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Mic, MicOff, Loader2, Trash2, Activity,
  Upload, FileText, UserCheck, Zap,
} from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { hmAsk, uploadHMDoc, getHMShortcuts } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import AudioVisualizer from './AudioVisualizer'

const DEEPGRAM_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY as string
const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-2&language=en-US&smart_format=true' +
  '&interim_results=true&utterance_end_ms=800&vad_events=true'
const FLUSH_DEBOUNCE_MS = 1000
const MAX_WS_RETRIES    = 6

interface VoiceEntry { id: string; utterance: string; answer: string; isStreaming: boolean }
interface Shortcut   { key: string; label: string; question: string }

export interface DocMeta { name: string; charCount: number }

interface Props {
  hmDocs: DocMeta[]
  onDocAdded: (meta: DocMeta) => void
}

export default function HMVoicePanel({ hmDocs, onDocAdded }: Props) {
  const { sessionId } = useSessionStore()

  const [phase, setPhase]               = useState<'upload' | 'qa'>(hmDocs.length > 0 ? 'qa' : 'upload')
  const [uploading, setUploading]       = useState(false)
  const [uploadError, setUploadError]   = useState('')
  const [isDragging, setIsDragging]     = useState(false)

  const [isRecording, setIsRecording]   = useState(false)
  const [audioActive, setAudioActive]   = useState(false)
  const [entries, setEntries]           = useState<VoiceEntry[]>([])
  const [permError, setPermError]       = useState('')
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [transcriptLog, setTranscriptLog] = useState<string[]>([])
  const [stableChunk, setStableChunk]   = useState('')
  const [interimChunk, setInterimChunk] = useState('')
  const [shortcuts, setShortcuts]               = useState<Shortcut[]>([])
  const [shortcutsLoading, setShortcutsLoading] = useState(false)

  const fileInputRef        = useRef<HTMLInputElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const qaScrollRef         = useRef<HTMLDivElement>(null)
  const sessionRef          = useRef(sessionId)
  const streamRef           = useRef<MediaStream | null>(null)
  const audioCtxRef         = useRef<AudioContext | null>(null)
  const stopPollRef         = useRef<(() => void) | null>(null)
  const wsRef               = useRef<WebSocket | null>(null)
  const recorderRef         = useRef<MediaRecorder | null>(null)
  const shouldRunRef        = useRef(false)
  const wsRetryCountRef     = useRef(0)
  const finalBufRef         = useRef('')
  const debounceTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioLevelRef       = useRef(0)
  const shortcutDocRef      = useRef(-1)

  useEffect(() => { sessionRef.current = sessionId }, [sessionId])
  useEffect(() => {
    const el = transcriptScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [transcriptLog, stableChunk, interimChunk])
  useEffect(() => {
    const el = qaScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])
  useEffect(() => () => { stopAll() }, [])

  // Sync hmDocs into phase (if parent already has docs when this mounts)
  useEffect(() => {
    if (hmDocs.length > 0 && phase === 'upload') setPhase('qa')
  }, [hmDocs])

  // Fetch shortcuts whenever entering Q&A phase or new docs are added
  useEffect(() => {
    if (phase !== 'qa') return
    const sid = sessionRef.current
    if (!sid) return
    if (shortcutDocRef.current === hmDocs.length && shortcuts.length > 0) return
    shortcutDocRef.current = hmDocs.length
    setShortcutsLoading(true)
    getHMShortcuts(sid).then(result => {
      if (result.length > 0) setShortcuts(result)
      setShortcutsLoading(false)
    })
  }, [phase, hmDocs.length])

  /* ─── Doc upload ───────────────────────────────────────────── */
  const handleFile = useCallback(async (file: File) => {
    const sid = sessionRef.current
    if (!sid) { setUploadError('No active session.'); return }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are accepted.')
      return
    }
    setUploadError('')
    setUploading(true)
    try {
      const res = await uploadHMDoc(sid, file)
      onDocAdded({ name: res.name, charCount: res.char_count })
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }, [onDocAdded])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  /* ─── LLM call ─────────────────────────────────────────────── */
  const processUtterance = useCallback((text: string) => {
    const sid = sessionRef.current
    if (!sid || !text.trim()) return
    const id = makeId()
    setEntries(prev => [...prev, { id, utterance: text, answer: '', isStreaming: true }])
    hmAsk(sid, text, {
      onToken: tok => setEntries(prev => prev.map(e => e.id === id ? { ...e, answer: e.answer + tok } : e)),
      onDone:  ()  => setEntries(prev => prev.map(e => e.id === id ? { ...e, isStreaming: false } : e)),
      onError: msg => setEntries(prev => prev.map(e => e.id === id
        ? { ...e, answer: `⚠ ${msg}`, isStreaming: false } : e)),
    })
  }, [])

  /* ─── Audio level poll ─────────────────────────────────────── */
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

  const cancelDebounce = useCallback(() => {
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null }
  }, [])

  const flushBuffer = useCallback(() => {
    cancelDebounce()
    const utterance = finalBufRef.current.trim()
    if (!utterance) return
    finalBufRef.current = ''
    setStableChunk('')
    setInterimChunk('')
    setTranscriptLog(prev => [...prev, utterance])
    processUtterance(utterance)
  }, [cancelDebounce, processUtterance])

  /* ─── Deepgram WebSocket ───────────────────────────────────── */
  const connectWS = useCallback((stream: MediaStream) => {
    if (!shouldRunRef.current) return
    const ws = new WebSocket(DEEPGRAM_URL, ['token', DEEPGRAM_KEY])
    wsRef.current = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      wsRetryCountRef.current = 0
      const prev = recorderRef.current
      if (prev && (prev.state === 'recording' || prev.state === 'paused')) {
        try { prev.stop() } catch { /* ignore */ }
      }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', '']
        .find(m => !m || MediaRecorder.isTypeSupported(m)) ?? ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorderRef.current = recorder
      recorder.ondataavailable = e => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
      }
      recorder.start(100)
    }

    ws.onmessage = e => {
      if (typeof e.data !== 'string') return
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'SpeechStarted') {
        cancelDebounce()
      } else if (msg.type === 'Results') {
        const alt = (msg.channel as { alternatives: { transcript: string }[] })?.alternatives?.[0]
        const text = alt?.transcript ?? ''
        const isFinal = msg.is_final as boolean
        const speechFinal = msg.speech_final as boolean

        if (!isFinal) {
          setInterimChunk(text)
        } else {
          setInterimChunk('')
          if (text.trim()) finalBufRef.current = (finalBufRef.current + ' ' + text).trim()
          setStableChunk(finalBufRef.current)
          if (speechFinal) {
            cancelDebounce()
            debounceTimerRef.current = setTimeout(flushBuffer, FLUSH_DEBOUNCE_MS)
          }
        }
      } else if (msg.type === 'UtteranceEnd') {
        flushBuffer()
      }
    }

    ws.onerror = () => { /* onclose fires next */ }
    ws.onclose = () => {
      if (!shouldRunRef.current) return
      setInterimChunk('')
      if (wsRetryCountRef.current >= MAX_WS_RETRIES) {
        setPermError('Connection to Deepgram lost. Stop and try again.')
        shouldRunRef.current = false
        setIsRecording(false)
        return
      }
      const delay = Math.min(500 * Math.pow(2, wsRetryCountRef.current), 8000)
      wsRetryCountRef.current++
      setTimeout(() => connectWS(stream), delay)
    }
  }, [cancelDebounce, flushBuffer])

  const startListening = useCallback(async () => {
    if (!shouldRunRef.current) return
    setPermError('')
    finalBufRef.current = ''
    wsRetryCountRef.current = 0

    if (!DEEPGRAM_KEY || DEEPGRAM_KEY === 'your_deepgram_api_key_here') {
      setPermError('Add VITE_DEEPGRAM_API_KEY to frontend/.env.local and restart.')
      shouldRunRef.current = false; setIsRecording(false); return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setPermError('Microphone access denied.')
      shouldRunRef.current = false; setIsRecording(false); return
    }
    streamRef.current = stream

    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx
    const source  = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)
    setAnalyserNode(analyser)
    stopPollRef.current?.()
    stopPollRef.current = startLevelPoll(analyser)
    connectWS(stream)
  }, [connectWS, startLevelPoll])

  const stopAll = useCallback(() => {
    shouldRunRef.current = false
    cancelDebounce()
    const prev = recorderRef.current
    if (prev && (prev.state === 'recording' || prev.state === 'paused')) {
      try { prev.stop() } catch { /* ignore */ }
    }
    try { wsRef.current?.close() } catch { /* ignore */ }
    streamRef.current?.getTracks().forEach(t => t.stop())
    stopPollRef.current?.()
    audioCtxRef.current?.close()
    recorderRef.current = null; wsRef.current = null
    streamRef.current = null; audioCtxRef.current = null
    stopPollRef.current = null; finalBufRef.current = ''
  }, [cancelDebounce])

  const toggleRecording = () => {
    if (isRecording) {
      stopAll()
      setIsRecording(false); setAudioActive(false)
      setAnalyserNode(null); setStableChunk(''); setInterimChunk('')
    } else {
      setPermError('')
      shouldRunRef.current = true
      setIsRecording(true)
      startListening()
    }
  }

  /* ─── Upload zone ───────────────────────────────────────────── */
  if (phase === 'upload') {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 px-8">
        <div className="w-full max-w-md space-y-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <UserCheck size={14} className="text-teal-400" />
              <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">HMV · Hiring Manager Voice</span>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Upload project PDFs (READMEs, reports, architecture docs) so answers reference your actual work and tech stack.
            </p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={[
              'border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors',
              isDragging
                ? 'border-teal-500/60 bg-teal-500/5'
                : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-900/40',
            ].join(' ')}
          >
            <Upload size={20} className="mx-auto mb-2 text-zinc-600" />
            <p className="text-[11px] text-zinc-400">Drop a project PDF here or <span className="text-teal-400">click to browse</span></p>
            <p className="text-[10px] text-zinc-600 mt-1">PDF only · max 10 MB · up to 5 docs</p>
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onFileInput} />
          </div>

          {uploading && (
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Loader2 size={11} className="animate-spin" /> Extracting text…
            </div>
          )}

          {uploadError && (
            <p className="text-[11px] text-red-400">{uploadError}</p>
          )}

          {hmDocs.length > 0 && (
            <div className="space-y-1.5">
              {hmDocs.map((d, i) => (
                <div key={i} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                  <FileText size={11} className="text-teal-400 shrink-0" />
                  <span className="text-[11px] text-zinc-300 flex-1 truncate">{d.name}</span>
                  <span className="text-[9px] text-zinc-600">{(d.charCount / 1000).toFixed(1)}k chars</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => setPhase('qa')}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Skip — use resume &amp; JD only
            </button>
            <button
              onClick={() => setPhase('qa')}
              className="text-[11px] font-semibold px-5 py-1.5 rounded-full bg-teal-600/20 border border-teal-500/40 text-teal-300 hover:bg-teal-600/30 transition-colors"
            >
              Start →
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ─── Voice Q&A ─────────────────────────────────────────────── */
  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">
      <div className="flex flex-col overflow-hidden flex-1">

        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-800/50 shrink-0">
          <div className="flex items-center gap-3">
            <UserCheck size={13} className="text-teal-400" />
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">HMV · Hiring Manager Voice</span>
            {isRecording && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-red-400 font-medium">Recording</span>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  {audioActive
                    ? <><Activity size={10} className="text-emerald-400" /><span className="text-emerald-400">Audio detected</span></>
                    : <><Activity size={10} className="text-zinc-600" /><span className="text-zinc-600">Waiting…</span></>
                  }
                </div>
              </>
            )}
            {/* Doc badges */}
            {hmDocs.slice(0, 3).map((d, i) => (
              <span key={i} className="flex items-center gap-1 text-[9px] bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5 text-zinc-500 max-w-[100px]">
                <FileText size={8} className="text-teal-500 shrink-0" />
                <span className="truncate">{d.name}</span>
              </span>
            ))}
            {hmDocs.length > 3 && (
              <span className="text-[9px] text-zinc-600">+{hmDocs.length - 3} more</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 rounded-md hover:bg-zinc-800/60"
              title="Add project doc"
            >
              <Upload size={11} /> Add doc
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onFileInput} />
            {entries.length > 0 && (
              <button onClick={() => { setEntries([]); setTranscriptLog([]) }}
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
                  : 'bg-teal-600/15 border-teal-500/40 text-teal-300 hover:bg-teal-600/25',
              ].join(' ')}
            >
              {isRecording ? <MicOff size={12} /> : <Mic size={12} />}
              {isRecording ? 'Stop' : 'Start Listening'}
            </button>
          </div>
        </div>

        {/* Visualizer */}
        <div className="px-5 py-2 border-b border-zinc-800/40 shrink-0">
          <AudioVisualizer analyser={analyserNode} active={isRecording} height={40} />
        </div>

        {/* Transcript panel */}
        <div className="flex flex-col border-b border-zinc-800/50 shrink-0" style={{ height: '35%' }}>
          <div className="flex items-center justify-between px-5 py-2 border-b border-zinc-800/30">
            <span className="text-[9px] font-bold text-teal-500 uppercase tracking-widest">Transcript</span>
            {isRecording && (stableChunk || interimChunk) && (
              <span className="text-[9px] text-zinc-600 animate-pulse">transcribing…</span>
            )}
          </div>
          <div ref={transcriptScrollRef} className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
            {!isRecording && !transcriptLog.length && !stableChunk ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Mic size={16} className="text-zinc-700" />
                </div>
                <p className="text-[11px] text-zinc-600">Press Start Listening and speak about your projects</p>
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed">
                {transcriptLog.map((line, i) => <span key={i} className="text-zinc-400">{line}{' '}</span>)}
                {stableChunk && <span className="text-zinc-200">{stableChunk}{' '}</span>}
                {interimChunk && <span className="text-zinc-500 italic">{interimChunk}</span>}
                {isRecording && <span className="inline-block w-[2px] h-[14px] bg-teal-400 animate-pulse align-middle ml-0.5" />}
              </p>
            )}
          </div>
        </div>

        {/* Quick-ask shortcuts bar */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-800/40 overflow-x-auto scrollbar-none shrink-0">
          <Zap size={10} className={shortcutsLoading ? 'text-teal-500 animate-pulse shrink-0' : 'text-zinc-600 shrink-0'} />
          {shortcutsLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 h-6 rounded-full bg-zinc-800/60 animate-pulse" style={{ width: `${52 + (i % 3) * 18}px` }} />
            ))
          ) : shortcuts.length === 0 ? (
            <span className="text-[10px] text-zinc-700 italic">Upload a project doc to generate quick-ask shortcuts</span>
          ) : (
            shortcuts.map(s => (
              <button
                key={s.key}
                onClick={() => processUtterance(s.question)}
                title={s.question}
                className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-full border bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-teal-600/50 hover:text-teal-300 hover:bg-teal-600/10 transition-all whitespace-nowrap"
              >
                {s.label}
              </button>
            ))
          )}
        </div>

        {/* AI answers */}
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="px-5 py-2 border-b border-zinc-800/30 shrink-0">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">AI Answers</span>
          </div>
          <div ref={qaScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
            {permError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[11px] text-red-400">{permError}</div>
            )}
            {entries.length === 0 && !permError && (
              <div className="flex items-center justify-center h-full">
                <p className="text-[11px] text-zinc-700">Answers appear here after each utterance</p>
              </div>
            )}
            {entries.map(entry => (
              <div key={entry.id} className="space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="text-[9px] text-zinc-600 uppercase tracking-widest shrink-0 mt-0.5 font-semibold w-10">Heard</span>
                  <p className="text-[11px] text-zinc-500 italic leading-snug">{entry.utterance}</p>
                </div>
                <div className="ml-12 bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-4 py-3">
                  {entry.answer ? (
                    <div className="answer-prose text-[12px] text-zinc-300 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.answer) }} />
                  ) : (
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Loader2 size={11} className="animate-spin" />
                      <span className="text-[10px]">Answering…</span>
                    </div>
                  )}
                  {entry.isStreaming && entry.answer && (
                    <span className="inline-block w-1.5 h-3 bg-teal-400 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-2 border-t border-zinc-800/40 shrink-0">
          <p className="text-[9px] text-zinc-700">
            Hiring Manager Voice · Deepgram nova-2 · project-aware answers
          </p>
        </div>
      </div>
    </div>
  )
}
