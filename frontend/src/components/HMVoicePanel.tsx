/**
 * HMVoicePanel — Hiring Manager Voice tab (HMV).
 *
 * STT pipeline (Deepgram + Web Speech fallback) lives in `useDeepgramSTT`.
 * This component wires per-utterance callbacks to /hm/ask, manages
 * shortcut buttons, and renders the 3-section answer cards.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Mic, MicOff, Trash2, Activity, UserCheck, Zap, AlertTriangle, Send,
} from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { hmAsk, getHMShortcuts } from '../api/client'
import { useDeepgramSTT } from '../utils/useSTT'
import AudioVisualizer from './AudioVisualizer'
import HMAnswerCard, { type HMSection } from './HMAnswerCard'

interface VoiceEntry {
  id: string
  utterance: string
  overview: string
  flow: string
  code: string
  isStreaming: boolean
}
interface Shortcut { key: string; label: string; question: string }

export default function HMVoicePanel() {
  const { sessionId } = useSessionStore()
  const sessionRef = useRef(sessionId)
  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  const [entries, setEntries]                     = useState<VoiceEntry[]>([])
  const [shortcuts, setShortcuts]                 = useState<Shortcut[]>([])
  const [shortcutsLoading, setShortcutsLoading]   = useState(false)
  const [textInput, setTextInput]                 = useState('')
  const abortRef                                  = useRef<AbortController | null>(null)
  const shortcutsAbortRef                         = useRef<AbortController | null>(null)
  const shortcutsFetched                          = useRef(false)
  const transcriptScrollRef                       = useRef<HTMLDivElement>(null)
  const qaScrollRef                               = useRef<HTMLDivElement>(null)

  const processUtterance = useCallback((text: string) => {
    const sid = sessionRef.current
    if (!sid || !text.trim()) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const id = makeId()
    setEntries(prev => [...prev, { id, utterance: text, overview: '', flow: '', code: '', isStreaming: true }])
    hmAsk(sid, text, {
      onToken: (tok, section) => setEntries(prev =>
        prev.map(e => {
          if (e.id !== id || !section) return e
          return { ...e, [section]: (e[section as HMSection] ?? '') + tok }
        })),
      onDone:  ()  => setEntries(prev => prev.map(e => e.id === id ? { ...e, isStreaming: false } : e)),
      onError: msg => setEntries(prev => prev.map(e => e.id === id
        ? { ...e, overview: `⚠ ${msg}`, isStreaming: false } : e)),
    }, ctrl.signal)
  }, [])

  // Abort any in-flight LLM / shortcut requests when this tab unmounts.
  useEffect(() => () => {
    abortRef.current?.abort()
    shortcutsAbortRef.current?.abort()
  }, [])

  const stt = useDeepgramSTT({ onUtterance: processUtterance, logTag: 'HMV-STT' })

  useEffect(() => {
    const el = transcriptScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stt.transcriptLog, stt.stableChunk, stt.interimChunk])
  useEffect(() => {
    const el = qaScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  // Fetch shortcuts once per session
  useEffect(() => {
    const sid = sessionRef.current
    if (!sid || shortcutsFetched.current) return
    shortcutsFetched.current = true
    setShortcutsLoading(true)
    const ctrl = new AbortController()
    shortcutsAbortRef.current = ctrl
    getHMShortcuts(sid, ctrl.signal).then(result => {
      if (result.length > 0) setShortcuts(result)
      setShortcutsLoading(false)
    })
  }, [sessionId])

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950">
        <p className="text-[11px] text-zinc-600">Create a session first (upload resume + JD on the Main tab)</p>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">
      <div className="flex flex-col overflow-hidden flex-1">

        {/* STT fallback notification */}
        {stt.notice && (
          <div className="flex items-center gap-2 px-5 py-2 bg-amber-500/10 border-b border-amber-500/30 shrink-0">
            <AlertTriangle size={12} className="text-amber-400 shrink-0" />
            <p className="text-[10px] text-amber-300 flex-1">{stt.notice}</p>
            <button onClick={stt.dismissNotice} className="text-[9px] text-amber-500 hover:text-amber-300">dismiss</button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-800/50 shrink-0">
          <div className="flex items-center gap-3">
            <UserCheck size={13} className="text-teal-400" />
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">HMV · Hiring Manager Voice</span>
            {stt.isRecording && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-red-400 font-medium">Recording</span>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  {stt.audioActive
                    ? <><Activity size={10} className="text-emerald-400" /><span className="text-emerald-400">Audio detected</span></>
                    : <><Activity size={10} className="text-zinc-600" /><span className="text-zinc-600">Waiting...</span></>
                  }
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {entries.length > 0 && (
              <button onClick={() => { setEntries([]); stt.clearTranscript() }}
                className="p-1.5 rounded-md text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors">
                <Trash2 size={12} />
              </button>
            )}
            <button
              onClick={stt.toggle}
              className={[
                'flex items-center gap-1.5 text-[11px] font-semibold px-4 py-1.5 rounded-full border transition-all',
                stt.isRecording
                  ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25'
                  : 'bg-teal-600/15 border-teal-500/40 text-teal-300 hover:bg-teal-600/25',
              ].join(' ')}
            >
              {stt.isRecording ? <MicOff size={12} /> : <Mic size={12} />}
              {stt.isRecording ? 'Stop' : 'Start Listening'}
            </button>
          </div>
        </div>

        {/* Visualizer */}
        <div className="px-5 py-2 border-b border-zinc-800/40 shrink-0">
          <AudioVisualizer analyser={stt.analyserNode} active={stt.isRecording} height={40} />
        </div>

        {/* Transcript */}
        <div className="flex flex-col border-b border-zinc-800/50 shrink-0" style={{ height: '35%' }}>
          <div className="flex items-center justify-between px-5 py-2 border-b border-zinc-800/30">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-teal-500 uppercase tracking-widest">Transcript</span>
              <span className="text-[8px] text-zinc-700 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5">
                {stt.mode === 'deepgram' ? 'Deepgram nova-2' : 'Web Speech'}
              </span>
            </div>
            {stt.isRecording && (stt.stableChunk || stt.interimChunk) && (
              <span className="text-[9px] text-zinc-600 animate-pulse">transcribing...</span>
            )}
          </div>
          <div ref={transcriptScrollRef} className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
            {!stt.isRecording && !stt.transcriptLog.length && !stt.stableChunk ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Mic size={16} className="text-zinc-700" />
                </div>
                <p className="text-[11px] text-zinc-600">Press Start Listening and speak about your projects</p>
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed">
                {stt.transcriptLog.map((line, i) => <span key={i} className="text-zinc-400">{line}{' '}</span>)}
                {stt.stableChunk && <span className="text-zinc-200">{stt.stableChunk}{' '}</span>}
                {stt.interimChunk && <span className="text-zinc-500 italic">{stt.interimChunk}</span>}
                {stt.isRecording && <span className="inline-block w-[2px] h-[14px] bg-teal-400 animate-pulse align-middle ml-0.5" />}
              </p>
            )}
          </div>
        </div>

        {/* Shortcuts */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-800/40 overflow-x-auto scrollbar-none shrink-0">
          <Zap size={10} className={shortcutsLoading ? 'text-teal-500 animate-pulse shrink-0' : 'text-zinc-600 shrink-0'} />
          {shortcutsLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 h-6 rounded-full bg-zinc-800/60 animate-pulse" style={{ width: `${52 + (i % 3) * 18}px` }} />
            ))
          ) : shortcuts.length === 0 ? (
            <span className="text-[10px] text-zinc-700 italic">No shortcuts yet — add docs in the Docs tab to generate them</span>
          ) : (
            shortcuts.map(s => (
              <button key={s.key} onClick={() => processUtterance(s.question)} title={s.question}
                className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-full border bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-teal-600/50 hover:text-teal-300 hover:bg-teal-600/10 transition-all whitespace-nowrap">
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
            {stt.permError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[11px] text-red-400">{stt.permError}</div>
            )}
            {entries.length === 0 && !stt.permError && (
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
                  <HMAnswerCard overview={entry.overview} flow={entry.flow} code={entry.code} isStreaming={entry.isStreaming} accent="teal" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Text input fallback when mic is unavailable */}
        <div className="shrink-0 border-t border-zinc-800/50 px-4 py-2.5">
          <div className="flex items-end gap-2">
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && textInput.trim()) {
                  processUtterance(textInput.trim())
                  setTextInput('')
                }
              }}
              placeholder={stt.permError ? "Type here (mic unavailable)..." : "Type or use voice..."}
              className="flex-1 bg-zinc-900 border border-zinc-700/70 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500/50 transition-colors"
            />
            <button
              onClick={() => { if (textInput.trim()) { processUtterance(textInput.trim()); setTextInput('') } }}
              disabled={!textInput.trim()}
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-teal-600/20 border border-teal-500/40 text-teal-400 hover:bg-teal-600/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={13} />
            </button>
          </div>
          <p className="text-[9px] text-zinc-700 mt-1">
            {stt.mode === 'deepgram' ? 'Deepgram nova-2' : 'Web Speech (fallback)'} · Bedrock Claude Opus · Supabase RAG · Enter to send
          </p>
        </div>
      </div>
    </div>
  )
}
