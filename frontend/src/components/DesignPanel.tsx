import { useCallback, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
} from 'reactflow'
import ComponentNode, { type ComponentNodeData } from './nodes/ComponentNode'
import { useSessionStore, type DesignComponent, type DesignStructure } from '../store/sessionStore'

const nodeTypes = { component: ComponentNode }

interface DesignPanelProps {
  design: DesignStructure
  onDrill: (component: DesignComponent) => void
}

export default function DesignPanel({ design, onDrill }: DesignPanelProps) {
  const selectedComponent = useSessionStore((s) => s.selectedComponent)

  const nodes: Node<ComponentNodeData>[] = useMemo(
    () =>
      design.components.map((comp) => ({
        id: comp.id,
        type: 'component',
        position: { x: comp.x, y: comp.y },
        data: {
          ...comp,
          onDrill,
          isSelected: selectedComponent?.id === comp.id,
        },
        draggable: true,
      })),
    [design.components, selectedComponent, onDrill],
  )

  const edges: Edge[] = useMemo(
    () =>
      design.connections.map((conn) => ({
        id: conn.id,
        source: conn.source,
        target: conn.target,
        label: conn.label,
        animated: false,
        style: { stroke: '#3f3f46', strokeWidth: 2 },
        labelStyle: { fill: '#71717a', fontSize: 11 },
        labelBgStyle: { fill: '#09090b' },
      })),
    [design.connections],
  )

  const onNodeClick = useCallback(() => {}, []) // handled in node itself

  return (
    <div className="h-full w-full">
      <ReactFlow
        key={selectedComponent ? 'drill-open' : 'drill-closed'}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
