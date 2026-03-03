import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Focus, BookOpen, Layers, Mic, BarChart2, Code2, LogOut, Loader2, ArrowLeft } from 'lucide-react'
import AnswersPanel from '../components/AnswersPanel'
import QueryBar from '../components/QueryBar'
import CodePanel from '../components/CodePanel'
import DesignPanel from '../components/DesignPanel'
import CenterView from '../components/CenterView'
import LiveVoicePanel from '../components/LiveVoicePanel'
import DeepDivePanel from '../components/DeepDivePanel'
import ArchFlowPanel from '../components/ArchFlowPanel'
import PracticePanel from '../components/PracticePanel'
import CodePracticePanel from '../components/CodePracticePanel'
import { useSessionStore, type DesignStructure, type DesignComponent } from '../store/sessionStore'
import { useAuthStore } from '../store/authStore'
import { loadSession, drillComponent } from '../api/client'
import clsx from 'clsx'

type View = 'main' | 'live' | 'deep' | 'arch' | 'behavioral' | 'technical' | 'code-practice'

const VALID_TABS = new Set<string>(['main', 'live', 'deep', 'arch', 'behavioral', 'technical', 'code-practice'])

const TABS: { id: View; label: string; icon: React.ReactNode; active: string; hover: string }[] = [
  { id: 'main',          label: 'Main',           icon: null,                        active: 'bg-zinc-700/70 text-zinc-200',     hover: 'hover:text-zinc-400' },
  { id: 'live',          label: 'Live',            icon: <Mic size={10} />,            active: 'bg-red-600/25 text-red-300',       hover: 'hover:text-red-400' },
  { id: 'deep',          label: 'Deep Dive',       icon: <BookOpen size={10} />,       active: 'bg-indigo-600/30 text-indigo-300', hover: 'hover:text-indigo-400' },
  { id: 'arch',          label: 'Architecture',    icon: <Layers size={10} />,         active: 'bg-amber-600/30 text-amber-300',   hover: 'hover:text-amber-400' },
  { id: 'behavioral',    label: 'Behavioral',      icon: <BarChart2 size={10} />,      active: 'bg-violet-600/30 text-violet-300', hover: 'hover:text-violet-400' },
  { id: 'technical',     label: 'Technical',       icon: <BarChart2 size={10} />,      active: 'bg-indigo-600/30 text-indigo-300', hover: 'hover:text-indigo-400' },
  { id: 'code-practice', label: 'Code',            icon: <Code2 size={10} />,          active: 'bg-cyan-600/25 text-cyan-300',     hover: 'hover:text-cyan-400' },
]

export default function Interview() {
  const navigate = useNavigate()
  const { sessionId: urlSessionId, tab } = useParams<{ sessionId: string; tab?: string }>()
  const { sessionId: storeSessionId, messages, currentDesign, reset, loadSession: loadSessionIntoStore } = useSessionStore()
  const { logout } = useAuthStore()

  const [loadingSession, setLoadingSession] = useState(false)
  const loadAttempted = useRef(false)

  // If URL has a session ID but store doesn't, load from API (e.g. page refresh / direct link)
  useEffect(() => {
    if (!urlSessionId) {
      navigate('/', { replace: true })
      return
    }
    // Store already has this session (navigated from Setup) — nothing to load
    if (storeSessionId === urlSessionId) {
      setLoadingSession(false)
      return
    }
    if (loadAttempted.current) return
    loadAttempted.current = true

    let cancelled = false
    setLoadingSession(true)
    loadSession(urlSessionId)
      .then((data) => {
        if (cancelled) return
        loadSessionIntoStore(
          data.session_id,
          {
            resumeId: data.resume_id ?? '',
            resumeTag: data.resume_tag ?? '',
            jdId: data.jd_id ?? '',
            jdLabel: data.jd_label ?? '',
          },
          data.messages,
        )
      })
      .catch(() => {
        if (cancelled) return
        // Only redirect if the store still doesn't have this session
        // (avoids race where Setup set the store but this API call was already in flight)
        if (useSessionStore.getState().sessionId !== urlSessionId) {
          navigate('/', { replace: true })
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSession(false)
      })

    return () => { cancelled = true }
  }, [urlSessionId, storeSessionId, navigate, loadSessionIntoStore])

  const view: View = (tab && VALID_TABS.has(tab) ? tab : 'main') as View

  const setView = (v: View) => {
    navigate(v === 'main' ? `/interview/${urlSessionId}` : `/interview/${urlSessionId}/${v}`, { replace: true })
  }

  const [centerMode, setCenterMode]   = useState(false)
  const [localDesign, setLocalDesign] = useState<DesignStructure | null>(null)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null)

  const hasMessages = messages.length > 0
  const { isStreaming } = useSessionStore()

  // Show artifact only for the explicitly selected answer (no fallback)
  const selectedMsg = selectedAnswerId
    ? messages.find(m => m.id === selectedAnswerId)
    : null
  const artifactMsg = selectedMsg ?? null
  const effectiveAnswerId = selectedAnswerId

  // Only show artifacts when an answer is explicitly selected
  const hasCode = !!selectedAnswerId && !!artifactMsg?.content && /```\w*\n/.test(artifactMsg.content)
  const activeDesign = selectedAnswerId ? (artifactMsg?.design ?? localDesign) : null
  const hasDesign = !!activeDesign
  const hasArtifact = hasCode || hasDesign

  // Auto-select the streaming answer when streaming starts, and the latest when it finishes
  const prevStreaming = useRef(isStreaming)
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) {
      // Streaming just started — select the new answer so its artifact shows live
      const latest = [...messages].reverse().find(m => m.role === 'assistant')
      if (latest) setSelectedAnswerId(latest.id)
    }
    if (prevStreaming.current && !isStreaming) {
      // Streaming finished — update selection to pick up final design/code
      const latest = [...messages].reverse().find(m => m.role === 'assistant')
      if (latest) {
        setSelectedAnswerId(latest.id)
        setLocalDesign(latest.design ?? null)
      }
    }
    prevStreaming.current = isStreaming
  }, [isStreaming, messages])

  // When user clicks any Q&A pair — toggle: click again to hide artifact
  const handleSelectAnswer = useCallback((answerId: string) => {
    if (selectedAnswerId === answerId) {
      setSelectedAnswerId(null)
      setLocalDesign(null)
    } else {
      setSelectedAnswerId(answerId)
      const msg = messages.find(m => m.id === answerId)
      setLocalDesign(msg?.design ?? null)
    }
  }, [messages, selectedAnswerId])

  useEffect(() => {
    if (!currentDesign) setLocalDesign(null)
  }, [currentDesign])

  const handleDesignReady = useCallback((design: DesignStructure) => {
    setLocalDesign(design)
  }, [])

  const handleClearDesign = useCallback(() => {
    setLocalDesign(null)
  }, [])

  const { startDrill, appendDrillContent, finalizeDrill, pushBreadcrumb } = useSessionStore()

  const handleDrill = useCallback((component: DesignComponent) => {
    if (!storeSessionId || !activeDesign) return
    startDrill(component, 1)
    pushBreadcrumb(component.name)
    drillComponent(
      storeSessionId,
      component.id,
      component.name,
      activeDesign.title,
      1,
      {
        onToken: (t) => appendDrillContent(t),
        onDone: () => finalizeDrill(),
        onError: () => finalizeDrill(),
      },
    )
  }, [storeSessionId, activeDesign, startDrill, pushBreadcrumb, appendDrillContent, finalizeDrill])

  const handleReset = () => {
    reset()
    navigate('/', { replace: true })
  }

  const handleLogout = () => {
    reset()
    logout()
    navigate('/login', { replace: true })
  }

  // Show loading state while fetching session from API
  if (loadingSession || (!storeSessionId && urlSessionId)) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex items-center gap-3 text-zinc-500">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading session…</span>
        </div>
      </div>
    )
  }

  if (!storeSessionId) return null

  return (
    <div className="h-screen flex bg-zinc-950 overflow-hidden">

      {/* ── Main content column ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">

        {/* Header */}
        <header className="flex items-center justify-between px-5 h-10 border-b border-zinc-800/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0 overflow-hidden">
            {/* Branding */}
            <span className="text-sm font-bold tracking-tight text-zinc-100 shrink-0">
              The<span className="text-indigo-400 ml-0.5">Panel</span>
            </span>

            {/* View tabs — always visible */}
            <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 overflow-x-auto">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id)}
                  className={clsx(
                    'flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors shrink-0',
                    view === tab.id ? tab.active : `text-zinc-600 ${tab.hover}`,
                  )}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {activeDesign && view === 'main' && (
              <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5 truncate max-w-[160px]">
                {activeDesign.title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {hasMessages && view === 'main' && (
              <>
                <button onClick={() => setCenterMode(true)} title="Focus mode"
                  className="p-1.5 rounded-lg text-zinc-600 hover:text-indigo-400 hover:bg-indigo-400/8 transition-colors">
                  <Focus size={14} />
                </button>
                <div className="w-px h-4 bg-zinc-800 mx-1" />
              </>
            )}
            <button onClick={handleReset}
              className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500 hover:text-zinc-200 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/60 transition-colors">
              <ArrowLeft size={12} />
              End Session
            </button>
            <button onClick={handleLogout} title="Sign out"
              className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/8 transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </header>

        {/* ── Live voice tab ── */}
        {view === 'live' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <LiveVoicePanel />
          </div>
        )}

        {/* ── Behavioral practice tab ── */}
        {view === 'behavioral' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <PracticePanel questionType="behavioral" />
          </div>
        )}

        {/* ── Technical practice tab ── */}
        {view === 'technical' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <PracticePanel questionType="technical" />
          </div>
        )}

        {/* ── Code Practice tab ── */}
        {view === 'code-practice' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <CodePracticePanel />
          </div>
        )}

        {/* ── Deep Dive view ── */}
        {view === 'deep' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <DeepDivePanel onBack={() => setView('main')} />
          </div>
        )}

        {/* ── Architecture Flow view ── */}
        {view === 'arch' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <ArchFlowPanel onBack={() => setView('main')} />
          </div>
        )}

        {/* ── Main 3-column view ── */}
        {view === 'main' && (
          <div className="flex-1 flex overflow-hidden min-h-0">

            {/* Col 1: Query bar + Answers */}
            <div
              className={clsx(
                'flex-1 flex flex-col min-h-0 overflow-hidden',
                hasArtifact ? 'border-r border-zinc-800/50' : '',
              )}
              style={{ minWidth: 260 }}
            >
              <div className="shrink-0 border-b border-zinc-800/60 px-4 py-3">
                <QueryBar
                  onDesignReady={handleDesignReady}
                  onClearDesign={handleClearDesign}
                  compact
                />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <AnswersPanel
                  selectedAnswerId={effectiveAnswerId}
                  onSelectAnswer={handleSelectAnswer}
                />
              </div>
            </div>

            {/* Col 2: Design diagram */}
            {hasDesign && activeDesign && (
              <div className="flex-1 overflow-hidden min-h-0" style={{ minWidth: 300 }}>
                <DesignPanel design={activeDesign} onDrill={handleDrill} />
              </div>
            )}

            {/* Col 3: Code */}
            {hasCode && artifactMsg && (
              <div className="flex-1 overflow-hidden min-h-0" style={{ minWidth: 220 }}>
                <CodePanel content={artifactMsg.content} />
              </div>
            )}

          </div>
        )}
      </div>

      {centerMode && <CenterView onClose={() => setCenterMode(false)} />}
    </div>
  )
}
