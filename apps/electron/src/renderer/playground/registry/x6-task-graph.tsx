import * as React from 'react'
import { Graph, type Node } from '@antv/x6'
import { register, getProvider } from '@antv/x6-react-shape'
import { Maximize, Minus, Plus, Workflow, X } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { TaskFlowNode, TASK_FLOW_NODE_SIZE, type TaskFlowNodeData } from '@/components/app-shell/kanban/TaskFlowNode'
import { TaskNodeInspector } from '@/components/app-shell/kanban/TaskNodeInspector'
import { autoLayout, specToGraph } from '@/components/app-shell/kanban/conductor-graph'
import type { WorkbenchSpec } from '@/components/app-shell/kanban/ConductorWorkbench'
import { isMac, isWindows, isWebUI } from '@/lib/platform'
import type { ComponentEntry } from './types'
import './x6-task-graph.css'

const spec: WorkbenchSpec = {
  id: 'x6-preview', title: '近期反馈调研', runner: 'conduct',
  nodes: [
    { id: 'official', title: '核对官方信息', kind: 'session', prompt: '核对官方公告与状态记录，区分已确认事实和未知边界。', outputs: [{ name: '官方信息摘要' }] },
    { id: 'community', title: '整理社区反馈', kind: 'session', prompt: '整理公开讨论，区分个人体验和可复核事实。', outputs: [{ name: '社区反馈摘要' }] },
    { id: 'verify', title: '独立核验并汇总', kind: 'verify', prompt: '等待两路核对完成，交叉核验来源，汇总简明结论。', depends_on: ['official', 'community'], outputs: [{ name: '核验结论' }] },
  ],
}

const phases = ['并行核对', '汇合核验', '全部完成'] as const
type Phase = typeof phases[number]
type ReactNodeData = {
  data: TaskFlowNodeData; selected: boolean; onSelect: () => void; onFocus: () => void
}

// Portals keep the app's theme and i18n context inside X6's foreignObject nodes.
register({
  shape: 'selection-x6-preview-task', ...TASK_FLOW_NODE_SIZE, effect: ['data'],
  component: ({ node }: { node: Node }) => <TaskFlowNode {...node.getData<ReactNodeData>()} />,
  attrs: { fo: { style: { overflow: 'visible' } } },
})
const X6Portals = getProvider()

function stateFor(id: string, phase: Phase) {
  return phase === '全部完成' ? 'done' : id === 'verify' ? phase === '汇合核验' ? 'running' : 'pending' : phase === '并行核对' ? 'running' : 'done'
}

function X6Canvas({ phase }: { phase: Phase }) {
  const host = React.useRef<HTMLDivElement>(null)
  const workbench = React.useRef<HTMLDivElement>(null)
  const graph = React.useRef<Graph>()
  const [selected, setSelected] = React.useState<string>()
  const [narrow, setNarrow] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [ready, setReady] = React.useState(false)
  const selectedRef = React.useRef(selected)
  const phaseRef = React.useRef(phase)
  selectedRef.current = selected
  phaseRef.current = phase
  const select = React.useCallback((id: string) => setSelected(id), [])
  const fit = React.useCallback(() => {
    graph.current?.zoomToFit({ padding: workbench.current!.clientWidth < 760 ? 20 : 52, maxScale: 1.25, minScale: 0.25 })
    graph.current?.centerContent()
  }, [])

  React.useEffect(() => {
    if (!host.current || !workbench.current) return
    const canvas = host.current
    const viewport = canvas.parentElement!
    const instance = new Graph({
      container: canvas, width: viewport.clientWidth, height: viewport.clientHeight,
      background: false, grid: false,
      panning: { enabled: true, eventTypes: ['leftMouseDown', 'mouseWheel'] },
      mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.25, maxScale: 2, zoomAtMousePosition: true },
      interacting: { nodeMovable: false, edgeMovable: false, magnetConnectable: false, arrowheadMovable: false, vertexMovable: false, vertexAddable: false, vertexDeletable: false },
      connecting: { allowBlank: false, allowLoop: false, allowNode: false, allowEdge: false },
    })
    // A plain SVG is exposed as an image by Chromium; the group preserves node buttons.
    instance.view.svg.setAttribute('role', 'group')
    instance.view.svg.setAttribute('aria-label', '并行核对与独立核验节点')
    graph.current = instance
    const reveal = (id: string) => {
      const button = instance.findViewByCell(id)?.container.querySelector('button')
      if (!button) return
      const box = button.getBoundingClientRect()
      const bounds = viewport.getBoundingClientRect()
      const dx = box.left < bounds.left + 16 ? bounds.left + 16 - box.left : box.right > bounds.right - 16 ? bounds.right - 16 - box.right : 0
      const dy = box.top < bounds.top + 16 ? bounds.top + 16 - box.top : box.bottom > bounds.bottom - 16 ? bounds.bottom - 16 - box.bottom : 0
      if (dx || dy) { const current = instance.translate(); instance.translate(current.tx + dx, current.ty + dy) }
    }
    let direction: 'LR' | 'TB' | undefined
    const layout = () => {
      const nextDirection = workbench.current!.clientWidth < 760 ? 'TB' : 'LR'
      if (direction === nextDirection) return
      direction = nextDirection
      const topology = autoLayout(specToGraph(spec), direction, TASK_FLOW_NODE_SIZE)
      // Three-node preview: stack the independent inputs on narrow screens so text
      // stays readable. Both connect to verification; there is no edge between them.
      if (nextDirection === 'TB') topology.nodes.forEach((node, index) => { node.x = 0; node.y = index * 168 })
      instance.resetCells([])
      instance.addNodes(topology.nodes.map(node => ({
        id: node.id, shape: 'selection-x6-preview-task', x: node.x, y: node.y,
        data: {
          data: { title: node.title, kind: node.kind, caption: node.prompt, state: stateFor(node.id, phaseRef.current), instanceCount: 1, direction: nextDirection },
          selected: selectedRef.current === node.id, onSelect: () => select(node.id), onFocus: () => reveal(node.id),
        } satisfies ReactNodeData,
      })))
      instance.addEdges(topology.edges.map(edge => ({
        id: `${edge.source}-${edge.target}`, shape: 'edge',
        source: { cell: edge.source, anchor: 'right', connectionPoint: 'anchor' },
        target: { cell: edge.target, anchor: nextDirection === 'LR' ? 'left' : 'right', connectionPoint: 'anchor' },
        ...(nextDirection === 'TB' ? { vertices: [
          { x: 320, y: topology.nodes.find(node => node.id === edge.source)!.y + TASK_FLOW_NODE_SIZE.height / 2 },
          { x: 320, y: topology.nodes.find(node => node.id === edge.target)!.y + TASK_FLOW_NODE_SIZE.height / 2 },
        ] } : { router: { name: 'orth', args: { padding: 24 } } }),
        connector: { name: 'rounded', args: { radius: 16 } },
        attrs: { line: { stroke: 'var(--task-graph-accent)', strokeWidth: 1.5, class: 'x6-preview-connection', targetMarker: { name: 'classic', width: 8, height: 6 } } },
      })))
      fit()
    }
    const resize = () => {
      instance.resize(viewport.clientWidth, viewport.clientHeight)
      setNarrow(workbench.current!.clientWidth < 760)
      layout()
      if (selectedRef.current && workbench.current!.clientWidth >= 760) reveal(selectedRef.current)
    }
    instance.on('scale', () => setZoom(instance.zoom()))
    instance.on('blank:click', () => setSelected(undefined))
    const observer = new ResizeObserver(resize)
    // X6 fixes the host's inline size; observe its flexible parent instead.
    observer.observe(viewport)
    resize()
    setReady(true)
    return () => { observer.disconnect(); instance.dispose(); graph.current = undefined }
  }, [fit, select])

  React.useEffect(() => {
    if (!ready || !graph.current) return
    graph.current.getNodes().forEach(node => {
      const current = node.getData<ReactNodeData>()
      node.setData({ ...current, selected: node.id === selected, data: { ...current.data, state: stateFor(node.id, phase) } }, { overwrite: true })
    })
    graph.current.getEdges().forEach(edge => {
      edge.attr('line/stroke', phase === '全部完成' ? 'var(--task-graph-complete)' : 'var(--task-graph-accent)')
      edge.attr('line/strokeDasharray', phase === '汇合核验' ? '5 7' : '')
    })
  }, [phase, selected, ready])

  const node = spec.nodes.find(node => node.id === selected)
  const covered = narrow && Boolean(node)
  const closeDetails = () => {
    const id = selected
    setSelected(undefined)
    requestAnimationFrame(() => {
      const view = id && graph.current?.findViewByCell(id)
      view && (view.container.querySelector('button') as HTMLButtonElement | null)?.focus()
    })
  }
  return <div ref={workbench} className="task-workbench x6-preview-workbench" data-phase={phase}>
    <div className="task-graph-canvas x6-preview-canvas" {...(covered ? { inert: '' } : {})} aria-hidden={covered || undefined}>
      <div ref={host} className="x6-preview-host" data-ready={ready} aria-label="三节点并行汇合任务图" />
      <p className="task-graph-canvas-hint">{narrow ? '两路独立核对 → 汇合核验 · 拖动平移' : '拖动画布平移 · ⌘ / Ctrl + 滚轮缩放'}</p>
      <div className="task-graph-controls" aria-label="任务图视图控制">
        <button type="button" aria-label="放大" onClick={() => graph.current?.zoomTo(Math.min(2, zoom * 1.15))} disabled={zoom >= 2}><Plus size={17} /></button>
        <button type="button" aria-label="缩小" onClick={() => graph.current?.zoomTo(Math.max(0.25, zoom / 1.15))} disabled={zoom <= 0.25}><Minus size={17} /></button>
        <span className="task-graph-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="适配画布" onClick={fit}><Maximize size={16} /></button>
      </div>
    </div>
    <X6Portals />
    {node && <TaskNodeInspector key={node.id} node={node} nodes={spec.nodes} instances={[]} state={stateFor(node.id, phase)} overlay={covered} onClose={closeDetails} onSelect={select} />}
  </div>
}

function X6TaskGraphPreview() {
  const nativeCaption = (isMac || isWindows) && !isWebUI
  const [open, setOpen] = React.useState(false)
  const [phase, setPhase] = React.useState<Phase>('并行核对')
  const trigger = React.useRef<HTMLButtonElement>(null)
  return <div className="x6-preview-root max-w-xl space-y-4 p-6">
    <div className="flex items-center gap-3"><Workflow className="size-5 text-[var(--pro-accent)]" /><h2 className="text-lg font-semibold">X6 · 三节点并行汇合</h2></div>
    <p className="text-sm leading-relaxed text-muted-foreground">两路核对并行执行，完成后汇合到独立核验。沿用 Selection 的节点卡片、黑白主题和 PRO 金色。</p>
    <button ref={trigger} type="button" className="x6-preview-open" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>打开 X6 预览</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="x6-preview-dialog automatic-task-graph-dialog flex flex-col gap-0 p-0 sm:max-w-none"
        overlayClassName="automatic-task-graph-overlay bg-black/25 backdrop-blur-sm"
        data-native-caption={nativeCaption} showCloseButton={false}
        onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}>
        <header className="titlebar-no-drag flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
          <Workflow className="size-5 shrink-0 text-[var(--pro-accent)]" aria-hidden="true" />
          <div className="min-w-0 flex-1"><DialogTitle className="truncate text-base leading-normal">{spec.title} · X6 预览</DialogTitle><DialogDescription className="mt-1 text-xs">三节点演示数据 · 点击节点查看职责</DialogDescription></div>
          <DialogClose className="task-graph-close" aria-label="关闭预览"><X size={20} /></DialogClose>
        </header>
        <div className="x6-preview-toolbar">
          <p role="status" className="text-xs text-muted-foreground">PRO 自动任务 · {phase}</p>
          <div className="x6-preview-phases" aria-label="演示执行阶段">{phases.map(item => <button key={item} type="button" aria-pressed={phase === item} onClick={() => setPhase(item)}>{item}</button>)}</div>
        </div>
        <div className="flex min-h-0 flex-1 p-4 pt-0"><X6Canvas phase={phase} /></div>
      </DialogContent>
    </Dialog>
  </div>
}

export const x6TaskGraphComponents: ComponentEntry[] = [{
  id: 'x6-task-graph', name: 'X6 Task Graph', category: 'Kanban',
  description: 'X6 prototype: two parallel tasks converge into independent verification, using Selection themes.', component: X6TaskGraphPreview,
  props: [],
}]
