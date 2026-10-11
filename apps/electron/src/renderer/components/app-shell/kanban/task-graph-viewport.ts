export type GraphViewport = { x: number; y: number; zoom: number }
export type GraphBounds = { x: number; y: number; width: number; height: number }

export function fitTaskGraph(bounds: GraphBounds, width: number, height: number): GraphViewport {
  const zoom = Math.max(0.1, Math.min(1.15, (width - 64) / Math.max(1, bounds.width), (height - 96) / Math.max(1, bounds.height)))
  return { x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.height * zoom) / 2 - bounds.y * zoom, zoom }
}

export function zoomTaskGraph(view: GraphViewport, factor: number, x: number, y: number): GraphViewport {
  const zoom = Math.max(0.1, Math.min(2, view.zoom * factor))
  return { x: x - (x - view.x) * zoom / view.zoom, y: y - (y - view.y) * zoom / view.zoom, zoom }
}

export function taskGraphEdgePath(source: { x: number; y: number }, target: { x: number; y: number }, direction: 'TB' | 'LR') {
  // Rounded elbows keep parallel inputs separate until their common target.
  const horizontal = direction === 'LR'
  const a = horizontal ? source.x : source.y
  const b = horizontal ? source.y : source.x
  const c = horizontal ? target.x : target.y
  const d = horizontal ? target.y : target.x
  const mid = (a + c) / 2
  const radius = Math.min(16, Math.abs(c - a) / 4, Math.abs(d - b) / 2)
  const sign = Math.sign(d - b)
  const point = (along: number, across: number) => horizontal ? `${along} ${across}` : `${across} ${along}`
  const path = !sign ? `M ${point(a, b)} L ${point(c, d)}`
    : `M ${point(a, b)} L ${point(mid - radius, b)} Q ${point(mid, b)} ${point(mid, b + sign * radius)} L ${point(mid, d - sign * radius)} Q ${point(mid, d)} ${point(mid + radius, d)} L ${point(c, d)}`
  return { path, labelX: (source.x + target.x) / 2, labelY: (source.y + target.y) / 2 }
}
