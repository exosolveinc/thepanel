/**
 * ContextBar — Horizontal "situation board" strip.
 * Shows what's being discussed + a mini arrow diagram of design components.
 * Lives below the header in Interview view.
 */
import { ChevronDown, ChevronRight, Activity } from 'lucide-react'
import { useState } from 'react'
import { useSessionStore } from '../store/sessionStore'

export default function ContextBar() {
  const { messages, currentDesign, isStreaming } = useSessionStore()
  const [collapsed, setCollapsed] = useState(false)

  const userMessages = messages.filter((m) => m.role === 'user')
  const lastUserMsg  = userMessages[userMessages.length - 1]

  // Need at least one exchange to show the bar
  if (userMessages.length === 0) return null

  // Sort design components left-to-right by x position for the flow diagram
  const flowComponents = currentDesign
    ? [...currentDesign.components].sort((a, b) => a.x - b.x).slice(0, 6)
    : []

  const exchangeCount = userMessages.length
  const topic = lastUserMsg?.content ?? ''
  const truncatedTopic = topic.length > 80 ? topic.slice(0, 80) + '…' : topic

  return (
    <div className="shrink-0 border-b border-zinc-800/40 bg-zinc-950">
      <div className="flex items-center h-8 px-3 gap-2 overflow-hidden">
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-zinc-700 hover:text-zinc-500 transition-colors shrink-0"
          title={collapsed ? 'Expand context bar' : 'Collapse context bar'}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>

        {collapsed ? (
          <span className="text-[10px] text-zinc-700 italic">context bar</span>
        ) : (
          <>
            {/* Live indicator when streaming */}
            {isStreaming && (
              <span className="flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-[10px] text-indigo-500">Live</span>
              </span>
            )}

            {/* Exchange count */}
            <span className="text-[10px] text-zinc-700 shrink-0">
              {exchangeCount} {exchangeCount === 1 ? 'exchange' : 'exchanges'}
            </span>

            <span className="text-zinc-800 shrink-0">·</span>

            {/* Current topic */}
            <div className="flex items-center gap-1 min-w-0 shrink">
              <Activity size={9} className="text-zinc-600 shrink-0" />
              <span className="text-[11px] text-zinc-500 truncate">{truncatedTopic}</span>
            </div>

            {/* Design flow diagram */}
            {flowComponents.length > 0 && (
              <>
                <span className="text-zinc-800 shrink-0">·</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  {flowComponents.map((c, i) => (
                    <span key={c.id} className="flex items-center gap-0.5">
                      {i > 0 && (
                        <span className="text-zinc-700 text-[10px] px-0.5">→</span>
                      )}
                      <span className="text-[10px] text-indigo-400/60 font-mono bg-indigo-500/5 border border-indigo-500/10 rounded px-1 py-px leading-none">
                        {c.name.length > 10 ? c.name.slice(0, 10) + '…' : c.name}
                      </span>
                    </span>
                  ))}
                  {currentDesign && currentDesign.components.length > 6 && (
                    <span className="text-[10px] text-zinc-700 ml-0.5">
                      +{currentDesign.components.length - 6}
                    </span>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
