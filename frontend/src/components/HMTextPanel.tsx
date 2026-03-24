/**
 * HMTextPanel — Hiring Manager Text tab (HMT).
 * Text-based Q&A about project work for hiring manager conversations.
 * Phase A: Upload project PDFs.
 * Phase B: Chat-style Q&A with streaming answers + quick-ask shortcuts.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, FileText, Loader2, Send, MessageSquare, Trash2, Zap } from 'lucide-react'
import { useSessionStore, makeId } from '../store/sessionStore'
import { hmAsk, uploadHMDoc, getHMShortcuts } from '../api/client'
import { renderMarkdown } from '../utils/markdown'

import type { DocMeta } from './HMVoicePanel'

interface QAEntry    { id: string; question: string; answer: string; isStreaming: boolean }
interface Shortcut   { key: string; label: string; question: string }

interface Props {
  hmDocs: DocMeta[]
  onDocAdded: (meta: DocMeta) => void
}

export default function HMTextPanel({ hmDocs, onDocAdded }: Props) {
  const { sessionId } = useSessionStore()

  const [phase, setPhase]             = useState<'upload' | 'qa'>(hmDocs.length > 0 ? 'qa' : 'upload')
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [isDragging, setIsDragging]   = useState(false)

  const [entries, setEntries]             = useState<QAEntry[]>([])
  const [input, setInput]                 = useState('')
  const [isAsking, setIsAsking]           = useState(false)
  const [shortcuts, setShortcuts]         = useState<Shortcut[]>([])
  const [shortcutsLoading, setShortcutsLoading] = useState(false)

  const fileInputRef    = useRef<HTMLInputElement>(null)
  const qaScrollRef     = useRef<HTMLDivElement>(null)
  const textareaRef     = useRef<HTMLTextAreaElement>(null)
  const abortRef        = useRef<AbortController | null>(null)
  const sessionRef      = useRef(sessionId)
  const shortcutDocRef  = useRef(-1)  // tracks hmDocs.length when shortcuts were last fetched

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

  // Sync phase if parent already has docs
  useEffect(() => {
    if (hmDocs.length > 0 && phase === 'upload') setPhase('qa')
  }, [hmDocs])

  // Fetch shortcuts whenever entering Q&A phase or new docs are added
  useEffect(() => {
    if (phase !== 'qa') return
    const sid = sessionRef.current
    if (!sid) return
    // Skip if we already fetched for this exact doc count
    if (shortcutDocRef.current === hmDocs.length && shortcuts.length > 0) return
    shortcutDocRef.current = hmDocs.length
    setShortcutsLoading(true)
    getHMShortcuts(sid).then(result => {
      if (result.length > 0) setShortcuts(result)
      setShortcutsLoading(false)
    })
  }, [phase, hmDocs.length])

  // Find a shortcut whose key starts with what the user typed
  const trimmed = input.trim().toLowerCase()
  const matchedShortcut = trimmed.length > 0
    ? (shortcuts.find(s => s.key.startsWith(trimmed)) ?? null)
    : null

  /* ─── Doc upload ──────────────────────────────────────────── */
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
    setEntries(prev => [...prev, { id, question, answer: '', isStreaming: true }])

    hmAsk(sid, question, {
      onToken: tok => setEntries(prev =>
        prev.map(e => e.id === id ? { ...e, answer: e.answer + tok } : e)),
      onDone: () => {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, isStreaming: false } : e))
        setIsAsking(false)
      },
      onError: msg => {
        setEntries(prev => prev.map(e => e.id === id
          ? { ...e, answer: `⚠ ${msg}`, isStreaming: false } : e))
        setIsAsking(false)
      },
    }, ctrl.signal)
  }, [])

  const submitQuestion = useCallback(() => {
    if (isAsking) return
    fireQuestion(input.trim())
  }, [input, isAsking, fireQuestion])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab: expand shorthand → full question (don't submit yet, let user review)
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

  /* ─── Upload zone ─────────────────────────────────────────── */
  if (phase === 'upload') {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 px-8">
        <div className="w-full max-w-md space-y-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-sky-400" />
              <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">HMT · Hiring Manager Text</span>
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
                ? 'border-sky-500/60 bg-sky-500/5'
                : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-900/40',
            ].join(' ')}
          >
            <Upload size={20} className="mx-auto mb-2 text-zinc-600" />
            <p className="text-[11px] text-zinc-400">Drop a project PDF here or <span className="text-sky-400">click to browse</span></p>
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
                  <FileText size={11} className="text-sky-400 shrink-0" />
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
              className="text-[11px] font-semibold px-5 py-1.5 rounded-full bg-sky-600/20 border border-sky-500/40 text-sky-300 hover:bg-sky-600/30 transition-colors"
            >
              Start →
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ─── Text Q&A ────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-800/50 shrink-0">
        <div className="flex items-center gap-3">
          <MessageSquare size={13} className="text-sky-400" />
          <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">HMT · Hiring Manager Text</span>
          {/* Doc badges */}
          {hmDocs.slice(0, 3).map((d, i) => (
            <span key={i} className="flex items-center gap-1 text-[9px] bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5 text-zinc-500 max-w-[100px]">
              <FileText size={8} className="text-sky-500 shrink-0" />
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
            <button
              onClick={() => { abortRef.current?.abort(); setEntries([]); setIsAsking(false) }}
              className="p-1.5 rounded-md text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors"
              title="Clear conversation"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
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
            {/* User question */}
            <div className="flex justify-end">
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-2.5 max-w-[75%]">
                <p className="text-[12px] text-zinc-300 leading-snug">{entry.question}</p>
              </div>
            </div>
            {/* AI answer */}
            <div className="flex justify-start">
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-4 py-3 max-w-[85%]">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                  <span className="text-[9px] text-sky-500 font-semibold uppercase tracking-widest">Answer</span>
                </div>
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
                  <span className="inline-block w-1.5 h-3 bg-sky-400 animate-pulse ml-0.5 align-middle" />
                )}
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
            // Loading skeleton chips
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 h-6 rounded-full bg-zinc-800/60 animate-pulse" style={{ width: `${52 + (i % 3) * 18}px` }} />
            ))
          ) : shortcuts.length === 0 ? (
            <span className="text-[10px] text-zinc-700 italic">No shortcuts yet — upload a project doc to generate them</span>
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
          {uploadError && <p className="text-[10px] text-red-400 mb-2">{uploadError}</p>}
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
              {/* Tab-to-expand hint */}
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
