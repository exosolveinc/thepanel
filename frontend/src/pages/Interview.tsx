import { useState, useCallback, useEffect } from 'react'
import { RotateCcw, Focus, Radio, BookOpen, Layers } from 'lucide-react'
import AnswersPanel from '../components/AnswersPanel'
import QueryBar from '../components/QueryBar'
import DesignPanel from '../components/DesignPanel'
import CodePanel from '../components/CodePanel'
import DrillDrawer from '../components/DrillDrawer'
import CenterView from '../components/CenterView'
import LiveVoicePanel from '../components/LiveVoicePanel'
import DeepDivePanel from '../components/DeepDivePanel'
import ArchFlowPanel from '../components/ArchFlowPanel'
import { drillComponent } from '../api/client'
import { useSessionStore, type DesignStructure, type DesignComponent } from '../store/sessionStore'
import clsx from 'clsx'

interface InterviewProps {
  onReset: () => void
}

type View = 'main' | 'deep' | 'arch'

export default function Interview({ onReset }: InterviewProps) {
  const {
    messages, currentDesign, selectedComponent,
    startDrill, appendDrillContent, finalizeDrill, pushBreadcrumb, sessionId,
  } = useSessionStore()

  const [view, setView]               = useState<View>('main')
  const [centerMode, setCenterMode]   = useState(false)
  const [voiceOpen, setVoiceOpen]     = useState(false)
  const [localDesign, setLocalDesign] = useState<DesignStructure | null>(null)

  const activeDesign  = currentDesign ?? localDesign
  const hasMessages   = messages.length > 0
  const lastAnswerMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.content)

  const hasDesign = !!activeDesign
  const hasCode   = !!lastAnswerMsg?.content && /```\w*\n/.test(lastAnswerMsg.content)

  useEffect(() => {
    if (!currentDesign) setLocalDesign(null)
  }, [currentDesign])

  const handleDesignReady = useCallback((design: DesignStructure) => {
    setLocalDesign(design)
  }, [])

  const handleClearDesign = useCallback(() => {
    setLocalDesign(null)
  }, [])

  const handleDrill = useCallback((component: DesignComponent) => {
    if (!sessionId || !activeDesign) return
    startDrill(component, 1)
    pushBreadcrumb(component.name)
    drillComponent(sessionId, component.id, component.name, activeDesign.summary, 1, {
      onToken: t => appendDrillContent(t),
      onDone:  () => finalizeDrill(),
      onError: msg => { appendDrillContent(`\n\n**Error:** ${msg}`); finalizeDrill() },
    })
  }, [sessionId, activeDesign, startDrill, pushBreadcrumb, appendDrillContent, finalizeDrill])

  return (
    <div className="h-screen flex bg-zinc-950 overflow-hidden">

      {/* ── Main content column ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">

        {/* Header */}
        <header className="flex items-center justify-between px-5 h-10 border-b border-zinc-800/80 shrink-0">
          <div className="flex items-center gap-3">
            {/* Branding */}
            <span className="text-sm font-bold tracking-tight text-zinc-100">
              The<span className="text-indigo-400 ml-0.5">Panel</span>
            </span>

            {/* View tabs */}
            {hasMessages && (
              <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
                <button
                  onClick={() => setView('main')}
                  className={clsx(
                    'text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors',
                    view === 'main'
                      ? 'bg-zinc-700/70 text-zinc-200'
                      : 'text-zinc-600 hover:text-zinc-400',
                  )}
                >
                  Main
                </button>
                <button
                  onClick={() => setView('deep')}
                  className={clsx(
                    'flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors',
                    view === 'deep'
                      ? 'bg-indigo-600/30 text-indigo-300'
                      : 'text-zinc-600 hover:text-indigo-400',
                  )}
                >
                  <BookOpen size={10} />
                  Deep Dive
                </button>
                <button
                  onClick={() => setView('arch')}
                  className={clsx(
                    'flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors',
                    view === 'arch'
                      ? 'bg-amber-600/30 text-amber-300'
                      : 'text-zinc-600 hover:text-amber-400',
                  )}
                >
                  <Layers size={10} />
                  Architecture
                </button>
              </div>
            )}

            {activeDesign && view === 'main' && (
              <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5 truncate max-w-[200px]">
                {activeDesign.title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            {hasMessages && view === 'main' && (
              <>
                <button onClick={() => setCenterMode(true)} title="Focus mode"
                  className="p-1.5 rounded-lg text-zinc-600 hover:text-indigo-400 hover:bg-indigo-400/8 transition-colors">
                  <Focus size={14} />
                </button>
                <button onClick={() => setVoiceOpen(v => !v)} title="Live voice listener"
                  className={clsx('p-1.5 rounded-lg transition-colors',
                    voiceOpen ? 'text-red-400 bg-red-400/10' : 'text-zinc-600 hover:text-red-400 hover:bg-red-400/8',
                  )}>
                  <Radio size={14} />
                </button>
                <div className="w-px h-4 bg-zinc-800 mx-1" />
              </>
            )}
            <button onClick={onReset} title="New session"
              className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors">
              <RotateCcw size={14} />
            </button>
          </div>
        </header>

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
                hasDesign || hasCode ? 'border-r border-zinc-800/50' : '',
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
                <AnswersPanel />
              </div>
            </div>

            {/* Col 2: Design */}
            {hasDesign && (
              <div
                className={clsx('flex-1 overflow-hidden min-h-0', hasCode ? 'border-r border-zinc-800/50' : '')}
                style={{ minWidth: 220 }}
              >
                <DesignPanel
                  key={selectedComponent ? 'drill-open' : 'drill-closed'}
                  design={activeDesign!}
                  onDrill={handleDrill}
                />
              </div>
            )}

            {/* Col 3: Code */}
            {hasCode && lastAnswerMsg && (
              <div className="flex-1 overflow-hidden min-h-0" style={{ minWidth: 220 }}>
                <CodePanel content={lastAnswerMsg.content} />
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Drill — full-height right, only in main view ── */}
      {view === 'main' && selectedComponent && (
        <div className="w-[28%] min-w-[280px] max-w-[420px] shrink-0 border-l border-zinc-700/70 overflow-hidden">
          <DrillDrawer inline />
        </div>
      )}

      {/* ── Voice — full-height far-right ── */}
      {voiceOpen && view === 'main' && (
        <div className="w-[200px] lg:w-[260px] shrink-0 border-l border-zinc-800/50 overflow-hidden">
          <LiveVoicePanel />
        </div>
      )}

      {centerMode && <CenterView onClose={() => setCenterMode(false)} />}
    </div>
  )
}
