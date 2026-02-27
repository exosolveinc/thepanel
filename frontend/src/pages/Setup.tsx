/**
 * Setup — session launcher with resume library, JD history, and past sessions.
 */
import { useState, useCallback, useRef } from 'react'
import {
  Upload, FileText, Briefcase, ArrowRight, AlertCircle, Loader2,
  Clock, MessageSquare, X, Tag, Check, ChevronRight, Plus,
} from 'lucide-react'
import { createSession } from '../api/client'
import { useSessionStore } from '../store/sessionStore'
import {
  getResumes, saveResume, deleteResume, resumeToFile,
  getJDs, saveJD, deleteJD,
  getSessions, deleteSessionRecord, formatRelativeDate,
  type SavedResume, type SavedJD, type SessionRecord,
} from '../utils/storage'

interface SetupProps {
  onReady: () => void
}

export default function Setup({ onReady }: SetupProps) {
  const { setSessionId, setSessionMeta } = useSessionStore()

  // Saved data
  const [savedResumes, setSavedResumes] = useState<SavedResume[]>(() => getResumes())
  const [savedJDs, setSavedJDs]         = useState<SavedJD[]>(() => getJDs())
  const [sessions, setSessions]         = useState<SessionRecord[]>(() => getSessions())

  // Active selections
  const [selectedResume, setSelectedResume] = useState<SavedResume | null>(savedResumes[0] ?? null)
  const [selectedJD, setSelectedJD]         = useState<SavedJD | null>(savedJDs[0] ?? null)

  // New upload fields
  const [newFile, setNewFile]   = useState<File | null>(null)
  const [newTag, setNewTag]     = useState('')
  const [jdText, setJdText]     = useState('')
  const [jdLabel, setJdLabel]   = useState('')

  // UI
  const [view, setView]           = useState<'sessions' | 'new'>(sessions.length > 0 ? 'sessions' : 'new')
  const [dragging, setDragging]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [savingResume, setSavingResume] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ─── resume helpers ─────────────────────────────────────── */

  const handleFileChange = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('PDF files only.')
      return
    }
    setNewFile(file)
    setNewTag(file.name.replace(/\.pdf$/i, ''))
    setSelectedResume(null)
    setError('')
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileChange(file)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaveResume = async () => {
    if (!newFile || !newTag.trim()) return
    setSavingResume(true)
    try {
      const saved = await saveResume(newFile, newTag.trim())
      const updated = getResumes()
      setSavedResumes(updated)
      setSelectedResume(saved)
      setNewFile(null)
      setNewTag('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setSavingResume(false)
    }
  }

  const removeResume = (id: string) => {
    deleteResume(id)
    const updated = getResumes()
    setSavedResumes(updated)
    if (selectedResume?.id === id) setSelectedResume(updated[0] ?? null)
  }

  /* ─── JD helpers ─────────────────────────────────────────── */

  const handleSaveJD = () => {
    if (!jdText.trim() || !jdLabel.trim()) return
    const saved = saveJD(jdText.trim(), jdLabel.trim())
    const updated = getJDs()
    setSavedJDs(updated)
    setSelectedJD(saved)
    setJdText('')
    setJdLabel('')
  }

  const removeJD = (id: string) => {
    deleteJD(id)
    const updated = getJDs()
    setSavedJDs(updated)
    if (selectedJD?.id === id) setSelectedJD(updated[0] ?? null)
  }

  /* ─── session start ──────────────────────────────────────── */

  const getActiveResume = (): File | null => {
    if (newFile) return newFile
    if (selectedResume) return resumeToFile(selectedResume)
    return null
  }

  const getActiveJD = (): string => {
    if (jdText.trim()) return jdText.trim()
    if (selectedJD) return selectedJD.text
    return ''
  }

  const canStart = !!(getActiveResume() && getActiveJD().length > 20)

  const startSession = async (
    resumeFile: File, jd: string,
    resumeId = '', rTag = '', jdIdVal = '', jdLabelVal = '',
  ) => {
    setLoading(true); setError('')
    try {
      const id = await createSession(resumeFile, jd)
      setSessionId(id)
      setSessionMeta(resumeId, rTag, jdIdVal, jdLabelVal)
      onReady()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const handleStart = async () => {
    const resumeFile = getActiveResume()
    const jd = getActiveJD()
    if (!resumeFile || jd.length < 20) return
    const rId  = newFile ? '' : (selectedResume?.id ?? '')
    const rTag = newFile ? newTag : (selectedResume?.tag ?? '')
    const jId  = jdText ? '' : (selectedJD?.id ?? '')
    const jLbl = jdText ? jdLabel : (selectedJD?.label ?? '')
    await startSession(resumeFile, jd, rId, rTag, jId, jLbl)
  }

  const resumePastSession = async (session: SessionRecord) => {
    const resume = savedResumes.find(r => r.id === session.resumeId)
    const jd     = savedJDs.find(j => j.id === session.jdId)
    if (!resume || !jd) {
      setError('Resume or JD for this session was deleted. Please start a new session with the same materials.')
      setView('new')
      return
    }
    await startSession(resumeToFile(resume), jd.text, resume.id, resume.tag, jd.id, jd.label)
  }

  /* ─── render ─────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-zinc-800/50">
        <div>
          <h1 className="text-xl font-bold">The <span className="text-indigo-400">Panel</span></h1>
          <p className="text-xs text-zinc-500 mt-0.5">AI interview co-pilot · Groq + Claude</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-zinc-500">Ready</span>
        </div>
      </div>

      {/* Tab nav */}
      {sessions.length > 0 && (
        <div className="flex gap-1 px-8 pt-5">
          {(['sessions', 'new'] as const).map(t => (
            <button
              key={t}
              onClick={() => setView(t)}
              className={[
                'px-4 py-1.5 rounded-full text-xs font-medium border transition-all',
                view === t
                  ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                  : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300',
              ].join(' ')}
            >
              {t === 'sessions' ? `Sessions (${sessions.length})` : '+ New Session'}
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 px-8 py-6 max-w-3xl mx-auto w-full space-y-4">

        {/* ── Sessions view ── */}
        {view === 'sessions' && (
          <div className="space-y-2.5">
            <p className="text-xs text-zinc-600 uppercase tracking-widest font-medium mb-4">Click a session to continue</p>
            {sessions.map(s => (
              <div
                key={s.id}
                className="group relative flex items-center gap-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl px-5 py-4 cursor-pointer transition-all"
                onClick={() => resumePastSession(s)}
              >
                <Clock size={13} className="text-zinc-600 shrink-0" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-px rounded-full">
                      {s.resumeTag || 'Resume'}
                    </span>
                    <span className="text-[10px] text-zinc-500 truncate">{s.jdLabel || 'Job Description'}</span>
                    <span className="text-[9px] text-zinc-700 ml-auto">{formatRelativeDate(s.date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare size={10} className="text-zinc-600 shrink-0" />
                    <span className="text-[10px] text-zinc-600">{s.questionCount} questions</span>
                    {s.lastQuestion && (
                      <>
                        <span className="text-zinc-800 text-[10px]">·</span>
                        <span className="text-[10px] text-zinc-500 italic truncate">
                          "{s.lastQuestion.slice(0, 60)}{s.lastQuestion.length > 60 ? '…' : ''}"
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <ChevronRight size={14} className="text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0" />

                <button
                  onClick={(e) => { e.stopPropagation(); deleteSessionRecord(s.id); setSessions(getSessions()) }}
                  className="absolute top-3 right-10 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all p-1"
                >
                  <X size={11} />
                </button>
              </div>
            ))}

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                <AlertCircle size={14} className="shrink-0" /> {error}
              </div>
            )}
          </div>
        )}

        {/* ── New session form ── */}
        {view === 'new' && (
          <div className="space-y-6">

            {/* Resume */}
            <section>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                <FileText size={12} className="text-indigo-400" /> Resume
              </p>

              {savedResumes.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {savedResumes.map(r => (
                    <div
                      key={r.id}
                      onClick={() => { setSelectedResume(r); setNewFile(null); setNewTag(''); setError('') }}
                      className={[
                        'group flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs cursor-pointer transition-all select-none',
                        selectedResume?.id === r.id && !newFile
                          ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300',
                      ].join(' ')}
                    >
                      {selectedResume?.id === r.id && !newFile && <Check size={10} className="text-indigo-400 shrink-0" />}
                      <Tag size={10} className="opacity-50 shrink-0" />
                      <span>{r.tag}</span>
                      <span className="text-zinc-700 text-[9px]">{r.sizeKB}KB</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeResume(r.id) }}
                        className="opacity-0 group-hover:opacity-100 ml-0.5 text-zinc-600 hover:text-red-400 transition-all"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label
                htmlFor="resume-file-input"
                className={[
                  'block border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all',
                  dragging    ? 'border-indigo-500 bg-indigo-500/5'
                  : newFile  ? 'border-emerald-600/50 bg-emerald-500/5'
                  : 'border-zinc-800 hover:border-zinc-600 bg-zinc-900/20',
                ].join(' ')}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
              >
                <input
                  id="resume-file-input" ref={fileInputRef}
                  type="file" accept=".pdf,application/pdf"
                  className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f) }}
                />
                {newFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <FileText size={13} className="text-emerald-400" />
                    <span className="text-emerald-400 font-medium">{newFile.name}</span>
                    <span className="text-zinc-600 text-xs">{(newFile.size / 1024).toFixed(0)} KB</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-zinc-500 text-sm">
                    <Upload size={13} />
                    <span>{savedResumes.length ? 'Upload another PDF' : 'Drop or click to upload resume PDF'}</span>
                  </div>
                )}
              </label>

              {newFile && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center gap-1.5 flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 focus-within:border-indigo-500/50">
                    <Tag size={11} className="text-zinc-600 shrink-0" />
                    <input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveResume() }}
                      placeholder="Label this resume (e.g. IBM SWE short)…"
                      className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleSaveResume}
                    disabled={!newTag.trim() || savingResume}
                    className="flex items-center gap-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg border border-zinc-700 transition-colors disabled:opacity-40"
                  >
                    {savingResume ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Save tag
                  </button>
                  <button
                    onClick={() => { setNewFile(null); setNewTag(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-zinc-600 hover:text-zinc-400 p-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </section>

            {/* Job Description */}
            <section>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                <Briefcase size={12} className="text-indigo-400" /> Job Description
              </p>

              {savedJDs.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {savedJDs.map(j => (
                    <div
                      key={j.id}
                      onClick={() => { setSelectedJD(j); setJdText(''); setJdLabel(''); setError('') }}
                      className={[
                        'group flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs cursor-pointer transition-all select-none',
                        selectedJD?.id === j.id && !jdText
                          ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300',
                      ].join(' ')}
                    >
                      {selectedJD?.id === j.id && !jdText && <Check size={10} className="text-indigo-400 shrink-0" />}
                      <span>{j.label}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeJD(j.id) }}
                        className="opacity-0 group-hover:opacity-100 ml-0.5 text-zinc-600 hover:text-red-400 transition-all"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                value={jdText}
                onChange={(e) => { setJdText(e.target.value); if (e.target.value) setSelectedJD(null) }}
                placeholder={savedJDs.length ? 'Or paste a new job description…' : 'Paste the job description — role, tech stack, requirements…'}
                className="w-full h-32 bg-zinc-900/30 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500/50 transition-colors"
              />

              {jdText.trim().length > 20 && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center gap-1.5 flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 focus-within:border-indigo-500/50">
                    <Tag size={11} className="text-zinc-600 shrink-0" />
                    <input
                      value={jdLabel}
                      onChange={(e) => setJdLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && jdLabel.trim()) handleSaveJD() }}
                      placeholder="Label this JD (e.g. Google Staff SWE)…"
                      className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none"
                    />
                  </div>
                  {jdLabel.trim() && (
                    <button
                      onClick={handleSaveJD}
                      className="flex items-center gap-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg border border-zinc-700 transition-colors"
                    >
                      <Plus size={11} /> Save JD
                    </button>
                  )}
                </div>
              )}
            </section>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                <AlertCircle size={14} className="shrink-0" /> {error}
              </div>
            )}

            {/* Start */}
            <button
              onClick={handleStart}
              disabled={!canStart || loading}
              className={[
                'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all',
                canStart && !loading
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 cursor-pointer'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed',
              ].join(' ')}
            >
              {loading
                ? <><Loader2 size={15} className="animate-spin" /> Preparing session…</>
                : <>Start Interview Session <ArrowRight size={15} /></>}
            </button>

            {!canStart && !loading && (
              <p className="text-center text-xs text-zinc-600">
                {!getActiveResume() ? 'Select or upload a resume PDF'
                  : 'Select or paste a job description (20+ chars)'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
