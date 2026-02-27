import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { ChevronRight } from 'lucide-react'
import type { DesignComponent } from '../../store/sessionStore'

export type ComponentNodeData = DesignComponent & {
  onDrill: (component: DesignComponent) => void
  isSelected: boolean
}

function ComponentNode({ data }: NodeProps<ComponentNodeData>) {
  const { name, description, tech, onDrill, isSelected, ...comp } = data

  return (
    <div
      className={[
        'relative bg-zinc-900 border rounded-xl p-4 w-64 cursor-pointer transition-all select-none group',
        isSelected
          ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
          : 'border-zinc-700 hover:border-zinc-500 hover:shadow-md hover:shadow-black/40',
      ].join(' ')}
      onClick={() => onDrill({ name, description, tech, ...comp } as DesignComponent)}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-zinc-600 !border-zinc-500"
      />

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-100 leading-tight">{name}</h3>
          <ChevronRight
            size={14}
            className="text-zinc-500 group-hover:text-indigo-400 transition-colors shrink-0 mt-0.5"
          />
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{description}</p>

        {tech.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {tech.slice(0, 4).map((t) => (
              <span
                key={t}
                className="inline-block text-[10px] px-1.5 py-0.5 bg-zinc-800 text-indigo-300 rounded font-mono border border-zinc-700"
              >
                {t}
              </span>
            ))}
            {tech.length > 4 && (
              <span className="inline-block text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded">
                +{tech.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-2 right-2 text-[9px] text-zinc-600 group-hover:text-indigo-500 transition-colors font-medium tracking-wide uppercase">
        drill in →
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-zinc-600 !border-zinc-500"
      />
    </div>
  )
}

export default memo(ComponentNode)
