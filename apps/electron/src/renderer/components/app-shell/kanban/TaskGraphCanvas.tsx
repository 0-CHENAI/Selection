import * as React from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TaskFlowNode, TASK_FLOW_NODE_SIZE, type TaskFlowNodeData } from './TaskFlowNode'
import { TaskFlowEdge } from './TaskFlowEdge'
import { fitTaskGraph, zoomTaskGraph, taskGraphEdgePath, type GraphViewport } from './task-graph-viewport'

export type TaskGraphNode = { id: string; position: { x: number; y: number }; data: TaskFlowNodeData }
export type TaskGraphEdge = { id: string; source: string; target: string; color: string; active: boolean; label?: string }

export function TaskGraphCanvas({ nodes, edges, selected, topologyKey, onSelect, compact }: {
  nodes: TaskGraphNode[]; edges: TaskGraphEdge[]; selected: string | null; topologyKey: string
  onSelect: (id: string | null) => void; compact?: boolean
}) {
  const { t } = useTranslation()
  const root = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const [view, setView] = React.useState<GraphViewport>({ x: 0, y: 0, zoom: 1 })
  const drag = React.useRef<{ id: number; x: number; y: number; view: GraphViewport; moved: boolean }>()
  const [panning, setPanning] = React.useState(false)
  const [transitioning, setTransitioning] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>()
  const bounds = React.useMemo(() => {
    const x = Math.min(0, ...nodes.map(node => node.position.x))
    const y = Math.min(0, ...nodes.map(node => node.position.y))
    return { x, y, width: Math.max(x + 1, ...nodes.map(node => node.position.x + TASK_FLOW_NODE_SIZE.width)) - x,
      height: Math.max(y + 1, ...nodes.map(node => node.position.y + TASK_FLOW_NODE_SIZE.height)) - y }
  }, [nodes])
  const animateTo = React.useCallback((next: GraphViewport) => {
    clearTimeout(timer.current)
    setTransitioning(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    setView(next)
    timer.current = setTimeout(() => setTransitioning(false), 220)
  }, [])
  React.useEffect(() => () => clearTimeout(timer.current), [])
  React.useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  React.useLayoutEffect(() => {
    if (size.width && size.height) animateTo(fitTaskGraph(bounds, size.width, size.height))
    // Live states leave the user's pan/zoom intact; only topology or canvas dimensions refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey, size.width, size.height, animateTo])
  React.useEffect(() => {
    const element = root.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setTransitioning(false)
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        setView(current => zoomTaskGraph(current, Math.exp(-event.deltaY * 0.008), event.clientX - rect.left, event.clientY - rect.top))
      } else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  const byId = new Map(nodes.map(node => [node.id, node]))
  const zoom = (factor: number) => animateTo(zoomTaskGraph(view, factor, size.width / 2, size.height / 2))
  const fit = () => animateTo(fitTaskGraph(bounds, size.width, size.height))
  return <div ref={root} className="task-graph-canvas" data-panning={panning} data-transitioning={transitioning}
    tabIndex={0} role="group" aria-label={t('tasks.graphTitle')}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2) }
      else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2) }
      else if (event.key === '0') { event.preventDefault(); fit() }
      else if (event.key.startsWith('Arrow')) {
        event.preventDefault(); setTransitioning(false)
        setView(current => ({ ...current, x: current.x + (event.key === 'ArrowLeft' ? 32 : event.key === 'ArrowRight' ? -32 : 0),
          y: current.y + (event.key === 'ArrowUp' ? 32 : event.key === 'ArrowDown' ? -32 : 0) }))
      }
    }}
    onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      const dx = event.clientX - current.x, dy = event.clientY - current.y
      if (!current.moved && Math.hypot(dx, dy) < 4) return
      current.moved = true
      setPanning(true); setTransitioning(false)
      setView({ ...current.view, x: current.view.x + dx, y: current.view.y + dy })
    }}
    onPointerUp={event => {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      if (!current.moved) onSelect(null)
      drag.current = undefined; setPanning(false)
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { drag.current = undefined; setPanning(false) }}>
    <div className="task-graph-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, visibility: size.width ? 'visible' : 'hidden' }}>
      <svg className="task-graph-connections" width={bounds.x + bounds.width + 32} height={bounds.y + bounds.height + 32}>
        {edges.map(edge => {
          const source = byId.get(edge.source), target = byId.get(edge.target)
          if (!source || !target) return null
          const horizontal = source.data.direction === 'LR'
          const start = { x: source.position.x + TASK_FLOW_NODE_SIZE.width * (horizontal ? 1 : 0.5), y: source.position.y + TASK_FLOW_NODE_SIZE.height * (horizontal ? 0.5 : 1) }
          const end = { x: target.position.x + TASK_FLOW_NODE_SIZE.width * (horizontal ? 0 : 0.5), y: target.position.y + TASK_FLOW_NODE_SIZE.height * (horizontal ? 0.5 : 0) }
          return <TaskFlowEdge key={edge.id} {...taskGraphEdgePath(start, end, source.data.direction)} color={edge.color} active={edge.active} label={edge.label} />
        })}
      </svg>
      {nodes.map(node => <div key={node.id} data-node-id={node.id} className="task-graph-node-position" style={{ left: node.position.x, top: node.position.y }}>
        <TaskFlowNode data={node.data} selected={selected === node.id} onSelect={() => onSelect(node.id)} onFocus={() => {
          const left = node.position.x * view.zoom + view.x, top = node.position.y * view.zoom + view.y
          if (left < 8 || top < 8 || left + TASK_FLOW_NODE_SIZE.width * view.zoom > size.width - 8 || top + TASK_FLOW_NODE_SIZE.height * view.zoom > size.height - 8) {
            animateTo({ ...view, x: size.width / 2 - (node.position.x + TASK_FLOW_NODE_SIZE.width / 2) * view.zoom,
              y: size.height / 2 - (node.position.y + TASK_FLOW_NODE_SIZE.height / 2) * view.zoom })
          }
        }} />
      </div>)}
    </div>
    <div className="task-graph-controls">
      <button type="button" aria-label={t('menu.zoomIn')} title={t('menu.zoomIn')} onClick={() => zoom(1.2)} disabled={view.zoom >= 2}><Plus size={17} /></button>
      <span className="task-graph-zoom">{Math.round(view.zoom * 100)}%</span>
      <button type="button" aria-label={t('menu.zoomOut')} title={t('menu.zoomOut')} onClick={() => zoom(1 / 1.2)} disabled={view.zoom <= 0.1}><Minus size={17} /></button>
      <button type="button" aria-label={t('overlay.zoomToFit')} title={t('overlay.zoomToFit')} onClick={fit}><Maximize size={16} /></button>
    </div>
    {!compact && nodes.length > 8 && <svg className="task-graph-overview" viewBox={`${bounds.x - 16} ${bounds.y - 16} ${bounds.width + 32} ${bounds.height + 32}`} aria-hidden="true">
      {nodes.map(node => <rect key={node.id} x={node.position.x} y={node.position.y} width={TASK_FLOW_NODE_SIZE.width} height={TASK_FLOW_NODE_SIZE.height} rx={12} className="task-graph-overview-node" data-selected={selected === node.id} />)}
      <rect x={-view.x / view.zoom} y={-view.y / view.zoom} width={size.width / view.zoom} height={size.height / view.zoom} fill="none" stroke="var(--task-graph-accent)" strokeWidth={3} />
    </svg>}
  </div>
}
