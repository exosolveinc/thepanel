import { useRef } from 'react'
import { X, ChevronRight, Loader2, Cpu } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { drillComponent } from '../api/client'
import { renderMarkdown } from '../utils/markdown'

/** Split drillContent into Quick Take summary and body (after first ---) */
function splitDrillContent(content: string): { summary: string; body: string } {
  const dividerIdx = content.indexOf('\n---')
  if (dividerIdx === -1) return { summary: '', body: content }
  const summary = content.slice(0, dividerIdx).replace(/^##\s*Quick Take\s*/i, '').trim()
  const body = content.slice(dividerIdx + 4).trim()
  return { summary, body }
}

function SummaryCard({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split('\n').map((l) => l.replace(/^[•\-]\s*/, '').trim()).filter(Boolean)
  return (
    <div className="drill-summary mb-4">
      <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-2">Quick Take</p>
      <ul>
        {lines.map((line, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: renderMarkdown(line).replace(/<\/?p>/g, '') }} />
        ))}
      </ul>
    </div>
  )
}

interface DrillDrawerProps {
  inline?: boolean  // when true: fills parent container instead of fixed overlay
}

export default function DrillDrawer({ inline }: DrillDrawerProps = {}) {
  const {
    sessionId, selectedComponent, currentDesign,
    drillContent, isDrilling, drillDepth, breadcrumb,
    setSelectedComponent, startDrill, appendDrillContent, finalizeDrill,
    pushBreadcrumb, popBreadcrumb,
  } = useSessionStore()

  const bodyRef = useRef<HTMLDivElement>(null)

  if (!selectedComponent) return null

  const { summary, body } = splitDrillContent(drillContent)

  return (
    <div className={inline
      ? 'h-full bg-zinc-900 flex flex-col'
      : 'fixed right-0 top-0 h-full w-full md:w-[480px] max-w-full bg-zinc-900 border-l border-zinc-700 shadow-2xl z-50 flex flex-col'
    }>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu size={16} className="text-indigo-400 shrink-0" />
          <div className="flex items-center gap-1 text-sm min-w-0">
            {breadcrumb.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={12} className="text-zinc-500 shrink-0" />}
                <span
                  className={i === breadcrumb.length - 1
                    ? 'text-zinc-100 font-medium truncate'
                    : 'text-zinc-400 truncate cursor-pointer hover:text-zinc-200'}
                  onClick={i < breadcrumb.length - 1 ? popBreadcrumb : undefined}
                >
                  {crumb}
                </span>
              </span>
            ))}
          </div>
        </div>
        <button onClick={() => setSelectedComponent(null)} className="text-zinc-400 hover:text-zinc-100 transition-colors ml-2 shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* Component info */}
      <div className="px-5 py-3 bg-zinc-950/50 border-b border-zinc-800 shrink-0">
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedComponent.tech.map((t) => (
            <span key={t} className="text-[11px] px-2 py-0.5 bg-indigo-500/10 text-indigo-300 rounded border border-indigo-500/20 font-mono">{t}</span>
          ))}
        </div>
        <p className="text-xs text-zinc-400">{selectedComponent.description}</p>
      </div>

      {/* Model badge */}
      <div className="px-5 pt-3 shrink-0">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-zinc-500 bg-zinc-800 border border-zinc-700 rounded-full px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          {drillDepth >= 2 ? 'Claude Opus 4.6' : 'Claude Sonnet 4.6'} · deep dive
        </span>
      </div>

      {/* Content */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
        {isDrilling && !drillContent && (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 size={14} className="animate-spin" />
            Analyzing {selectedComponent.name}...
          </div>
        )}

        {/* Quick Take summary — appears once the --- divider arrives */}
        {summary && <SummaryCard text={summary} />}

        {/* Body */}
        {body && (
          <div className="answer-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        )}

        {/* Streaming cursor */}
        {isDrilling && drillContent && (
          <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
        )}
      </div>

      {/* Go deeper */}
      {!isDrilling && drillContent && drillDepth < 2 && (
        <div className="px-5 py-4 border-t border-zinc-800 shrink-0">
          <button
            onClick={() => {
              if (!sessionId || !currentDesign) return
              startDrill(selectedComponent, 2)
              pushBreadcrumb('Deep Dive')
              drillComponent(sessionId, selectedComponent.id, selectedComponent.name, currentDesign.summary, 2, {
                onToken: (text) => appendDrillContent(text),
                onDone:  () => finalizeDrill(),
                onError: (msg) => { appendDrillContent(`\n\n**Error:** ${msg}`); finalizeDrill() },
              })
            }}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            Go Deeper <ChevronRight size={15} />
          </button>
          <p className="text-xs text-zinc-500 text-center mt-2">Uses Claude Opus 4.6 — implementation-level detail</p>
        </div>
      )}
    </div>
  )
}
