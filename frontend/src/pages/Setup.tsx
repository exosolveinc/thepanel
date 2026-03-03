/**
 * Setup — session launcher with folder-based resume/JD library.
 * Sidebar: folder list. Detail: Library (resumes + JDs side by side) | Past Sessions.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload, FileText, Briefcase, AlertCircle, Loader2,
  Clock, MessageSquare, X, Plus, LogOut, FolderOpen, Pencil, Trash2,
  Check, ChevronRight, Play, MoreHorizontal,
} from 'lucide-react'
import {
  createSession, loadSession,
  listFolders, createFolder, updateFolder, deleteFolder as apiDeleteFolder,
  uploadResume, deleteResume as apiDeleteResume,
  saveJD as apiSaveJD, deleteJD as apiDeleteJD,
  deleteSession as apiDeleteSession, clearFolderSessions as apiClearFolderSessions,
  type LibFolder, type SavedSession,
} from '../api/client'
import { useSessionStore } from '../store/sessionStore'
import { useAuthStore } from '../store/authStore'
import clsx from 'clsx'

/* ── helpers ──────────────────────────────────────────────────── */

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/* ── component ───────────────────────────────────────────────── */

export default function Setup() {
  const navigate = useNavigate()
  const { setSessionId, setSessionMeta, loadSession: loadSessionIntoStore } = useSessionStore()
  const { user, logout } = useAuthStore()

  const [folders, setFolders] = useState<LibFolder[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)

  // Folder UI
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmClearSessionsId, setConfirmClearSessionsId] = useState<string | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  // Selection
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null)
  const [selectedJDId, setSelectedJDId] = useState<string | null>(null)

  // Upload / new JD
  const [newFile, setNewFile] = useState<File | null>(null)
  const [newTag, setNewTag] = useState('')
  const [jdText, setJdText] = useState('')
  const [jdLabel, setJdLabel] = useState('')
  const [instructions, setInstructions] = useState('')
  const [savingResume, setSavingResume] = useState(false)
  const [dragging, setDragging] = useState(false)

  // UI
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'library' | 'sessions'>('library')

  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ─── fetch folders ─────────────────────────────────────────── */

  const refreshFolders = useCallback(async () => {
    const data = await listFolders()
    setFolders(data)
    return data
  }, [])

  useEffect(() => {
    refreshFolders().then(data => {
      if (data.length > 0 && !activeId) setActiveId(data[0].id)
      setInitialLoad(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeFolder = folders.find(f => f.id === activeId) ?? null

  // Auto-select when switching folders
  useEffect(() => {
    if (!activeFolder) return
    setSelectedResumeId(activeFolder.resumes.length === 1 ? activeFolder.resumes[0].id : null)
    setSelectedJDId(activeFolder.jds.length === 1 ? activeFolder.jds[0].id : null)
    resetInputs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const resetInputs = () => {
    setNewFile(null); setNewTag(''); setJdText(''); setJdLabel(''); setInstructions(''); setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /* ─── folder CRUD ───────────────────────────────────────────── */

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      const folder = await createFolder(name)
      await refreshFolders()
      setCreatingFolder(false); setNewFolderName('')
      setActiveId(folder.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create folder.')
    }
  }

  const handleRenameFolder = async (id: string) => {
    const name = renameValue.trim()
    if (!name) return
    try {
      await updateFolder(id, { name })
      await refreshFolders()
      setRenamingId(null); setRenameValue('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to rename folder.')
    }
  }

  const handleDeleteFolder = async (id: string) => {
    try {
      await apiDeleteFolder(id)
      const data = await refreshFolders()
      if (activeId === id) setActiveId(data[0]?.id ?? null)
      setConfirmDeleteId(null); setMenuOpenId(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete folder.')
    }
  }

  /* ─── resume CRUD ───────────────────────────────────────────── */

  const handleFileChange = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('PDF files only.'); return
    }
    setNewFile(file)
    setNewTag(file.name.replace(/\.pdf$/i, ''))
    setSelectedResumeId(null); setError('')
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileChange(file)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSaveResume = async () => {
    if (!newFile || !newTag.trim() || !activeId) return
    setSavingResume(true)
    try {
      const saved = await uploadResume(newFile, newTag.trim(), activeId)
      const updated = await refreshFolders()
      setSelectedResumeId(saved.id)
      setNewFile(null); setNewTag('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      const folder = updated.find(f => f.id === activeId)
      if (folder?.jds.length === 1 && !selectedJDId) setSelectedJDId(folder.jds[0].id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save resume.')
    } finally {
      setSavingResume(false)
    }
  }

  const handleDeleteResume = async (id: string) => {
    await apiDeleteResume(id)
    await refreshFolders()
    if (selectedResumeId === id) setSelectedResumeId(null)
  }

  /* ─── JD CRUD ───────────────────────────────────────────────── */

  const handleSaveJD = async () => {
    if (!jdText.trim() || !jdLabel.trim() || !activeId) return
    try {
      const saved = await apiSaveJD(jdLabel.trim(), jdText.trim(), activeId)
      const updated = await refreshFolders()
      setSelectedJDId(saved.id)
      setJdText(''); setJdLabel('')
      const folder = updated.find(f => f.id === activeId)
      if (folder?.resumes.length === 1 && !selectedResumeId) setSelectedResumeId(folder.resumes[0].id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save JD.')
    }
  }

  const handleDeleteJD = async (id: string) => {
    await apiDeleteJD(id)
    await refreshFolders()
    if (selectedJDId === id) setSelectedJDId(null)
  }

  /* ─── session helpers ───────────────────────────────────────── */

  const handleDeleteSession = async (id: string) => {
    await apiDeleteSession(id)
    await refreshFolders()
  }

  const handleClearFolderSessions = async (folderId: string) => {
    await apiClearFolderSessions(folderId)
    await refreshFolders()
    setConfirmClearSessionsId(null)
  }

  /* ─── start / resume ─────────────────────────────────────────── */

  const selectedResume = activeFolder?.resumes.find(r => r.id === selectedResumeId) ?? null
  const selectedJD = activeFolder?.jds.find(j => j.id === selectedJDId) ?? null
  const hasActiveResume = !!(newFile || selectedResume)
  const activeJDText = jdText.trim() || selectedJD?.text || ''
  const canStart = !!(hasActiveResume && activeJDText.length > 20)

  const handleStart = async () => {
    if (!canStart) return
    const resumeFile = newFile
    const resumeId = selectedResume?.id
    const rTag = newFile ? newTag : (selectedResume?.tag ?? '')
    const jId = jdText ? undefined : (selectedJD?.id ?? undefined)
    const jLbl = jdText ? jdLabel : (selectedJD?.label ?? '')

    setLoading(true); setError('')
    try {
      const id = await createSession(resumeFile ?? null, activeJDText, resumeId, jId, activeId ?? undefined, instructions.trim() || undefined)
      setSessionId(id)
      setSessionMeta(resumeId ?? '', rTag, jId ?? '', jLbl)
      navigate(`/interview/${id}`, { replace: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start session.')
    } finally {
      setLoading(false)
    }
  }

  const resumePastSession = async (session: SavedSession) => {
    setLoading(true); setError('')
    try {
      const data = await loadSession(session.id)
      loadSessionIntoStore(
        data.session_id,
        { resumeId: data.resume_id ?? '', resumeTag: data.resume_tag ?? '', jdId: data.jd_id ?? '', jdLabel: data.jd_label ?? '' },
        data.messages,
      )
      navigate(`/interview/${data.session_id}`, { replace: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load session.')
    } finally {
      setLoading(false)
    }
  }

  /* ─── render ─────────────────────────────────────────────────── */

  if (initialLoad) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <Loader2 size={20} className="animate-spin text-zinc-600" />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-6 h-13 border-b border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight">
            The<span className="text-indigo-400 ml-0.5">Panel</span>
          </h1>
          <span className="text-[10px] text-zinc-600 hidden sm:inline">AI interview co-pilot</span>
        </div>
        <div className="flex items-center gap-3">
          {user && <span className="text-xs text-zinc-500">{user.name}</span>}
          <button
            onClick={() => { logout(); navigate('/login', { replace: true }) }}
            title="Sign out"
            className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/8 transition-colors"
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* ── Main: sidebar + detail ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Sidebar: folder list ── */}
        <aside className="w-[240px] shrink-0 flex flex-col border-r border-zinc-800/60 bg-zinc-950">
          <div className="flex items-center justify-between px-4 h-10 border-b border-zinc-800/40 shrink-0">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Folders</span>
            <button
              onClick={() => { setCreatingFolder(true); setNewFolderName('') }}
              className="p-1 rounded-md text-zinc-600 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors"
              title="New folder"
            >
              <Plus size={13} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {creatingFolder && (
              <div className="px-3 py-1.5">
                <div className="flex items-center gap-1.5 bg-zinc-900 border border-indigo-500/40 rounded-lg px-2.5 py-2 focus-within:border-indigo-500/60">
                  <FolderOpen size={12} className="text-indigo-400 shrink-0" />
                  <input
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateFolder()
                      if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
                    }}
                    autoFocus
                    placeholder="Folder name…"
                    className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none min-w-0"
                  />
                  <button onClick={handleCreateFolder} disabled={!newFolderName.trim()}
                    className="text-indigo-400 hover:text-indigo-300 disabled:text-zinc-700 transition-colors shrink-0">
                    <Check size={12} />
                  </button>
                  <button onClick={() => { setCreatingFolder(false); setNewFolderName('') }}
                    className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0">
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}

            {folders.map(folder => {
              const isActive = activeId === folder.id
              const isRenaming = renamingId === folder.id
              const total = folder.resumes.length + folder.jds.length
              return (
                <div key={folder.id} className="relative group">
                  <button
                    onClick={() => { if (!isRenaming) setActiveId(folder.id) }}
                    className={clsx(
                      'w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors',
                      isActive ? 'bg-zinc-800/70 border-r-2 border-indigo-500' : 'hover:bg-zinc-900/60',
                    )}
                  >
                    <FolderOpen size={14} className={isActive ? 'text-indigo-400' : 'text-zinc-600'} />
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <input
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameFolder(folder.id)
                            if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                          }}
                          onBlur={() => { setRenamingId(null); setRenameValue('') }}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                          className="w-full bg-transparent text-xs font-medium text-zinc-200 border-b border-indigo-500/50 focus:outline-none py-0"
                        />
                      ) : (
                        <span className={clsx('text-xs font-medium truncate block', isActive ? 'text-zinc-100' : 'text-zinc-400')}>
                          {folder.name}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600 block mt-0.5">{total} items</span>
                    </div>
                  </button>

                  {/* Context menu */}
                  <div className={clsx(
                    'absolute right-2 top-2.5 transition-opacity',
                    menuOpenId === folder.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === folder.id ? null : folder.id) }}
                      className="p-1 rounded text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                    {menuOpenId === folder.id && (
                      <div className="absolute right-0 top-7 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 py-1 w-32"
                        onMouseLeave={() => setMenuOpenId(null)}>
                        <button
                          onClick={() => { setRenamingId(folder.id); setRenameValue(folder.name); setMenuOpenId(null) }}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800 flex items-center gap-2 transition-colors"
                        >
                          <Pencil size={10} /> Rename
                        </button>
                        {confirmDeleteId === folder.id ? (
                          <div className="px-3 py-1.5 space-y-1">
                            <p className="text-[10px] text-red-400">Delete folder + all contents?</p>
                            <div className="flex gap-1">
                              <button onClick={() => handleDeleteFolder(folder.id)}
                                className="flex-1 text-[10px] py-1 bg-red-500/20 text-red-400 rounded border border-red-500/30 hover:bg-red-500/30">
                                Delete
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)}
                                className="flex-1 text-[10px] py-1 text-zinc-500 rounded border border-zinc-700 hover:text-zinc-300">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(folder.id)}
                            className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-zinc-800 flex items-center gap-2 transition-colors">
                            <Trash2 size={10} /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {folders.length === 0 && !creatingFolder && (
              <div className="px-4 py-8 text-center">
                <FolderOpen size={24} className="text-zinc-800 mx-auto mb-2" />
                <p className="text-[11px] text-zinc-600">No folders yet</p>
                <button onClick={() => setCreatingFolder(true)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-2 transition-colors">
                  Create your first folder
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Detail panel ── */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!activeFolder ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <FolderOpen size={32} className="text-zinc-800" />
              <p className="text-sm text-zinc-600">Select a folder to get started</p>
              <button onClick={() => setCreatingFolder(true)}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors">
                <Plus size={12} /> New Folder
              </button>
            </div>
          ) : (
            <>
              {/* Folder header + tabs */}
              <div className="flex items-center justify-between px-6 h-12 border-b border-zinc-800/50 shrink-0">
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-semibold text-zinc-100 truncate">{activeFolder.name}</h2>
                  <div className="flex items-center gap-0">
                    {([
                      { id: 'library' as const, label: 'Library', count: activeFolder.resumes.length + activeFolder.jds.length },
                      { id: 'sessions' as const, label: 'Sessions', count: activeFolder.sessions.length },
                    ]).map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={clsx(
                          'text-[11px] font-medium px-3 py-1.5 rounded-md transition-colors',
                          activeTab === tab.id
                            ? 'bg-zinc-800 text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-300',
                        )}
                      >
                        {tab.label}
                        {tab.count > 0 && (
                          <span className={clsx(
                            'ml-1.5 text-[9px] font-semibold rounded-full px-1.5 py-px',
                            activeTab === tab.id ? 'bg-indigo-500/20 text-indigo-300' : 'bg-zinc-800 text-zinc-600',
                          )}>
                            {tab.count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto min-h-0">

                {/* ── Library tab: Resumes + JDs side by side ── */}
                {activeTab === 'library' && (
                  <div className="flex flex-1 min-h-full">

                    {/* Left column: Resumes */}
                    <div className="flex-1 border-r border-zinc-800/40 flex flex-col min-w-0">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/30 shrink-0">
                        <div className="flex items-center gap-2">
                          <FileText size={12} className="text-indigo-400" />
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Resumes</span>
                          {activeFolder.resumes.length > 0 && (
                            <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded-full px-1.5 py-px">{activeFolder.resumes.length}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
                        {activeFolder.resumes.map(r => {
                          const selected = selectedResumeId === r.id && !newFile
                          return (
                            <div
                              key={r.id}
                              onClick={() => { setSelectedResumeId(r.id); setNewFile(null); setNewTag(''); setError('') }}
                              className={clsx(
                                'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all group',
                                selected ? 'bg-indigo-500/10 border border-indigo-500/30' : 'hover:bg-zinc-900/60 border border-transparent',
                              )}
                            >
                              <div className={clsx(
                                'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                                selected ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-700 group-hover:border-zinc-500',
                              )}>
                                {selected && <Check size={9} className="text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className={clsx('text-xs font-medium block truncate', selected ? 'text-indigo-200' : 'text-zinc-300')}>
                                  {r.tag}
                                </span>
                                <span className="text-[10px] text-zinc-600 block truncate">{r.file_name} · {formatDate(r.created_at)}</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteResume(r.id) }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-all shrink-0"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )
                        })}

                        {/* Upload zone */}
                        <label
                          htmlFor="resume-upload"
                          className={clsx(
                            'flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-3 cursor-pointer transition-all text-[11px] mt-2',
                            dragging ? 'border-indigo-500 bg-indigo-500/5 text-indigo-300'
                            : newFile ? 'border-emerald-600/50 bg-emerald-500/5 text-emerald-400'
                            : 'border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-zinc-400',
                          )}
                          onDrop={handleDrop}
                          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                          onDragLeave={() => setDragging(false)}
                        >
                          <input
                            id="resume-upload"
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            className="sr-only"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f) }}
                          />
                          {newFile ? (
                            <>
                              <FileText size={12} className="text-emerald-400" />
                              <span className="font-medium truncate">{newFile.name}</span>
                            </>
                          ) : (
                            <>
                              <Upload size={12} />
                              <span>Upload PDF</span>
                            </>
                          )}
                        </label>

                        {newFile && (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              value={newTag}
                              onChange={e => setNewTag(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveResume() }}
                              placeholder="Label…"
                              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                            />
                            <button
                              onClick={handleSaveResume}
                              disabled={!newTag.trim() || savingResume}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium rounded-lg transition-colors disabled:opacity-40"
                            >
                              {savingResume ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                              Save
                            </button>
                            <button onClick={() => { setNewFile(null); setNewTag(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                              className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors">
                              <X size={12} />
                            </button>
                          </div>
                        )}

                        {activeFolder.resumes.length === 0 && !newFile && (
                          <p className="text-center text-[10px] text-zinc-700 py-6">No resumes yet</p>
                        )}
                      </div>
                    </div>

                    {/* Right column: JDs */}
                    <div className="flex-1 flex flex-col min-w-0">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/30 shrink-0">
                        <div className="flex items-center gap-2">
                          <Briefcase size={12} className="text-indigo-400" />
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Job Descriptions</span>
                          {activeFolder.jds.length > 0 && (
                            <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded-full px-1.5 py-px">{activeFolder.jds.length}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
                        {activeFolder.jds.map(j => {
                          const selected = selectedJDId === j.id && !jdText
                          return (
                            <div
                              key={j.id}
                              onClick={() => { setSelectedJDId(j.id); setJdText(''); setJdLabel(''); setError('') }}
                              className={clsx(
                                'flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all group',
                                selected ? 'bg-indigo-500/10 border border-indigo-500/30' : 'hover:bg-zinc-900/60 border border-transparent',
                              )}
                            >
                              <div className={clsx(
                                'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                                selected ? 'border-indigo-500 bg-indigo-500' : 'border-zinc-700 group-hover:border-zinc-500',
                              )}>
                                {selected && <Check size={9} className="text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className={clsx('text-xs font-medium block truncate', selected ? 'text-indigo-200' : 'text-zinc-300')}>
                                  {j.label}
                                </span>
                                <span className="text-[10px] text-zinc-600 block truncate">
                                  {j.text.slice(0, 60)}{j.text.length > 60 ? '…' : ''} · {formatDate(j.created_at)}
                                </span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteJD(j.id) }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-all shrink-0"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )
                        })}

                        {/* Add new JD */}
                        <div className="mt-2 space-y-1.5">
                          <textarea
                            value={jdText}
                            onChange={e => { setJdText(e.target.value); if (e.target.value) setSelectedJDId(null) }}
                            placeholder={activeFolder.jds.length ? 'Paste a new JD…' : 'Paste the job description…'}
                            className="w-full h-20 bg-zinc-900/30 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500/50 transition-colors"
                          />
                          {jdText.trim().length > 20 && (
                            <div className="flex items-center gap-2">
                              <input
                                value={jdLabel}
                                onChange={e => setJdLabel(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && jdLabel.trim()) handleSaveJD() }}
                                placeholder="Label (e.g. Google Staff SWE)…"
                                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                              />
                              {jdLabel.trim() && (
                                <button onClick={handleSaveJD}
                                  className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium rounded-lg transition-colors">
                                  <Plus size={10} /> Save
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {activeFolder.jds.length === 0 && !jdText && (
                          <p className="text-center text-[10px] text-zinc-700 py-6">No JDs yet</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Sessions tab ── */}
                {activeTab === 'sessions' && (
                  <div className="p-6">
                    {activeFolder.sessions.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-zinc-500">
                            {activeFolder.sessions.length} session{activeFolder.sessions.length !== 1 ? 's' : ''}
                          </span>
                          {confirmClearSessionsId === activeFolder.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleClearFolderSessions(activeFolder.id)}
                                className="px-2 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded border border-red-500/30 hover:bg-red-500/30">
                                Clear all
                              </button>
                              <button onClick={() => setConfirmClearSessionsId(null)}
                                className="px-2 py-0.5 text-[10px] text-zinc-500 rounded border border-zinc-700 hover:text-zinc-300">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmClearSessionsId(activeFolder.id)}
                              className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">
                              Clear all
                            </button>
                          )}
                        </div>

                        <div className="border border-zinc-800/60 rounded-xl overflow-hidden">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="border-b border-zinc-800/60 bg-zinc-900/40">
                                <th className="px-4 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Resume</th>
                                <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">JD</th>
                                <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Qs</th>
                                <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Last Question</th>
                                <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Date</th>
                                <th className="px-3 py-2.5 w-16"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeFolder.sessions.map(s => (
                                <tr
                                  key={s.id}
                                  onClick={() => resumePastSession(s)}
                                  className="border-b border-zinc-800/30 cursor-pointer hover:bg-zinc-900/40 transition-colors group"
                                >
                                  <td className="px-4 py-2.5">
                                    {s.resume_tag ? (
                                      <span className="text-[11px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-2 py-0.5">
                                        {s.resume_tag}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-zinc-600">—</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="text-[11px] text-zinc-400 truncate block max-w-[120px]">{s.jd_label || '—'}</span>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <MessageSquare size={10} className="text-zinc-600" />
                                      <span className="text-[11px] text-zinc-400">{s.question_count}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="text-[11px] text-zinc-500 italic truncate block max-w-[200px]">
                                      {s.last_question ? `"${s.last_question.slice(0, 50)}${s.last_question.length > 50 ? '…' : ''}"` : '—'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="text-[11px] text-zinc-600">{formatRelativeDate(s.created_at)}</span>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id) }}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-all"
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                      <ChevronRight size={12} className="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <Clock size={24} className="text-zinc-800 mx-auto mb-2" />
                        <p className="text-[11px] text-zinc-600">No sessions yet. Start one below.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Bottom action bar ── */}
              <div className="shrink-0 border-t border-zinc-800/50 px-6 py-3 bg-zinc-950">
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
                    <AlertCircle size={12} className="shrink-0" /> {error}
                  </div>
                )}

                {/* Optional instructions */}
                <div className="mb-3">
                  <textarea
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    placeholder="Custom instructions (optional) — e.g. &quot;Focus on distributed systems&quot;, &quot;Answer in concise bullet points&quot;, &quot;Emphasize AWS experience&quot;…"
                    className="w-full h-14 bg-zinc-900/40 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-zinc-300 placeholder-zinc-600 resize-none focus:outline-none focus:border-indigo-500/40 transition-colors"
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <FileText size={11} className={hasActiveResume ? 'text-emerald-400' : 'text-zinc-700'} />
                      <span className={hasActiveResume ? 'text-zinc-300' : 'text-zinc-600'}>
                        {newFile ? newTag || newFile.name : selectedResume?.tag || 'No resume'}
                      </span>
                    </div>
                    <span className="text-zinc-800">+</span>
                    <div className="flex items-center gap-1.5">
                      <Briefcase size={11} className={activeJDText.length > 20 ? 'text-emerald-400' : 'text-zinc-700'} />
                      <span className={activeJDText.length > 20 ? 'text-zinc-300 truncate max-w-[200px]' : 'text-zinc-600'}>
                        {jdText.trim() ? `New JD (${jdText.trim().length} chars)` : selectedJD?.label || 'No JD'}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleStart}
                    disabled={!canStart || loading}
                    className={clsx(
                      'flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shrink-0',
                      canStart && !loading
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-zinc-800 text-zinc-600 cursor-not-allowed',
                    )}
                  >
                    {loading ? (
                      <><Loader2 size={14} className="animate-spin" /> Starting…</>
                    ) : (
                      <><Play size={13} /> Start Session</>
                    )}
                  </button>
                </div>

                {!canStart && !loading && (
                  <p className="text-[10px] text-zinc-600 mt-1.5">
                    {!hasActiveResume ? 'Select or upload a resume' : 'Select or paste a JD (20+ chars)'}
                  </p>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
