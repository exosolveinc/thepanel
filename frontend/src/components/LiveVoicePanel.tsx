/**
 * LiveVoicePanel — live listening tab.
 *
 * STT pipeline (Deepgram + Web Speech fallback) lives in `useDeepgramSTT`.
 * This component wires the per-utterance callback to /live-ask and renders
 * the transcript / answer UI.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Mic, MicOff, Loader2, Trash2, Radio, Activity, AlertTriangle } from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { liveAsk } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import { useDeepgramSTT } from '../utils/useSTT'
import CodePanel from './CodePanel'
import AudioVisualizer from './AudioVisualizer'

interface VoiceEntry {
  id: string
  utterance: string
  answer: string
  isStreaming: boolean
}

const HAS_CODE = (s: string) => /```\w*\n/.test(s)

export default function LiveVoicePanel() {
  const { sessionId } = useSessionStore()
  const sessionRef = useRef(sessionId)
  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  const [entries, setEntries]         = useState<VoiceEntry[]>([])
  const [sessionError, setSessionError] = useState('')
  const abortRef                      = useRef<AbortController | null>(null)
  const transcriptScrollRef           = useRef<HTMLDivElement>(null)
  const qaScrollRef                   = useRef<HTMLDivElement>(null)

  const processUtterance = useCallback((text: string) => {
    const sid = sessionRef.current
    if (!sid || !text.trim()) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const id = makeId()
    setEntries(prev => [...prev, { id, utterance: text, answer: '', isStreaming: true }])
    liveAsk(sid, text, {
      onToken: tok =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, answer: e.answer + tok } : e)),
      onDone: () =>
        setEntries(prev => prev.map(e => e.id === id ? { ...e, isStreaming: false } : e)),
      onError: msg => {
        if (msg.toLowerCase().includes('session not found')) setSessionError(msg)
        setEntries(prev => prev.map(e => e.id === id
          ? { ...e, answer: `⚠ ${msg}`, isStreaming: false } : e))
      },
    }, ctrl.signal)
  }, [])

  // Abort any in-flight LLM call when this tab unmounts.
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const stt = useDeepgramSTT({ onUtterance: processUtterance, logTag: 'Live-STT' })

  useEffect(() => {
    const el = transcriptScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stt.transcriptLog, stt.stableChunk, stt.interimChunk])
  useEffect(() => {
    const el = qaScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  const latestCodeEntry = [...entries].reverse().find(e => HAS_CODE(e.answer))
  const showCode = !!latestCodeEntry

  const clearAll = () => {
    setEntries([])
    stt.clearTranscript()
    setSessionError('')
  }

  const hasContent =
    entries.length > 0 || stt.transcriptLog.length > 0 || !!stt.stableChunk || !!stt.interimChunk

  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">

      <div className={`flex flex-col overflow-hidden ${showCode ? 'w-[55%] border-r border-zinc-800/60' : 'flex-1'}`}>

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
            <Radio size={13} className={stt.isRecording ? 'text-red-400' : 'text-zinc-600'} />
            <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">Live Listener</span>
            {stt.isRecording && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-red-400 font-medium">Recording</span>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  {stt.audioActive
                    ? <><Activity size={10} className="text-emerald-400" /><span className="text-emerald-400">Audio detected</span></>
                    : <><Activity size={10} className="text-zinc-600" /><span className="text-zinc-600">Waiting for speech...</span></>
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
              onClick={stt.toggle}
              className={[
                'flex items-center gap-1.5 text-[11px] font-semibold px-4 py-1.5 rounded-full border transition-all',
                stt.isRecording
                  ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25'
                  : 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/25',
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
        <div className="flex flex-col border-b border-zinc-800/50 shrink-0" style={{ height: '38%' }}>
          <div className="flex items-center justify-between px-5 py-2 border-b border-zinc-800/30">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Transcript</span>
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
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Mic size={18} className="text-zinc-700" />
                </div>
                <p className="text-[11px] text-zinc-500">
                  Press <span className="text-indigo-400">Start Listening</span> to begin transcription
                </p>
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed">
                {stt.transcriptLog.map((line, i) => <span key={i} className="text-zinc-400">{line}{' '}</span>)}
                {stt.stableChunk && <span className="text-zinc-200">{stt.stableChunk}{' '}</span>}
                {stt.interimChunk && <span className="text-zinc-500 italic">{stt.interimChunk}</span>}
                {stt.isRecording && <span className="inline-block w-[2px] h-[14px] bg-indigo-400 animate-pulse align-middle ml-0.5" />}
              </p>
            )}
          </div>
        </div>

        {/* AI answers */}
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="px-5 py-2 border-b border-zinc-800/30 shrink-0">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">AI Answers</span>
          </div>
          <div ref={qaScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
            {stt.permError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[11px] text-red-400 leading-relaxed">{stt.permError}</div>
            )}
            {sessionError && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-[11px] text-amber-300 leading-relaxed">
                Session expired — go back to Setup and create a new session.
              </div>
            )}
            {entries.length === 0 && !stt.permError && !sessionError && (
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
                <div className={[
                  'ml-12 rounded-xl px-4 py-3',
                  entry.answer.startsWith('⚠')
                    ? 'bg-red-500/8 border border-red-500/20'
                    : 'bg-zinc-900/60 border border-zinc-800/80',
                ].join(' ')}>
                  {entry.answer.startsWith('⚠') ? (
                    <p className="text-[11px] text-red-400">{entry.answer.slice(2).trim()}</p>
                  ) : entry.answer ? (
                    <div className="answer-prose text-[12px] text-zinc-300 quick-answer leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.answer) }} />
                  ) : (
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Loader2 size={11} className="animate-spin" />
                      <span className="text-[10px]">Answering...</span>
                    </div>
                  )}
                  {entry.isStreaming && entry.answer && !entry.answer.startsWith('⚠') && (
                    <span className="inline-block w-1.5 h-3 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-2 border-t border-zinc-800/40 shrink-0">
          <p className="text-[9px] text-zinc-700">
            {stt.mode === 'deepgram' ? 'Deepgram nova-2 via backend proxy' : 'Web Speech API (fallback)'} · /live-ask · does not affect main chat
          </p>
        </div>
      </div>

      {showCode && (
        <div className="flex-1 overflow-hidden min-w-0">
          <CodePanel content={latestCodeEntry!.answer} />
        </div>
      )}
    </div>
  )
}
