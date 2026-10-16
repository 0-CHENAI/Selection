/** Read-only rail geometry for the conversation task list. */

export const RAIL_X = 5
export const RAIL_INDENT = 14
export const RAIL_LABEL_GAP = 14
export const RAIL_NODE_HOLE = 4
export const RAIL_STROKE = 1.25
export const REACHED_NODE_RADIUS = 3
export const OPEN_NODE_RADIUS = 3.25

export const RAIL_TRAVEL_SPRING = { stiffness: 140, damping: 26, mass: 0.6 } as const
export const RAIL_TURN_SPRING = { stiffness: 260, damping: 30 } as const

export type TaskRailStatus = 'pending' | 'in_progress' | 'completed' | 'interrupted'

export interface RailNode {
  x: number
  y: number
}

export interface PointSampler {
  getTotalLength(): number
  getPointAtLength(length: number): { x: number; y: number }
}

export function railNodeX(depth = 0): number {
  return RAIL_X + depth * RAIL_INDENT
}

export function railLabelPadding(depth = 0): number {
  return railNodeX(depth) + RAIL_LABEL_GAP
}

function fmt(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/**
 * Path starts at the first node's x on the top edge.
 * A depth change inserts two bends at 30% of the vertical gap, then straight segments.
 */
export function buildRailPath(nodes: readonly RailNode[]): string {
  if (nodes.length === 0) return ''
  const commands = [`M ${fmt(nodes[0]!.x)} 0`]
  let previous = { x: nodes[0]!.x, y: 0 }
  for (const node of nodes) {
    if (node.x !== previous.x) {
      const bend = (node.y - previous.y) * 0.3
      commands.push(`L ${fmt(previous.x)} ${fmt(previous.y + bend)}`)
      commands.push(`L ${fmt(node.x)} ${fmt(node.y - bend)}`)
    }
    commands.push(`L ${fmt(node.x)} ${fmt(node.y)}`)
    previous = node
  }
  return commands.join(' ')
}

/** Current step: the in-progress item, else the stopped item, else the next pending item. All-complete parks on the last node. */
export function railTargetIndex(statuses: readonly TaskRailStatus[]): number {
  if (statuses.length === 0) return -1
  const current = statuses.indexOf('in_progress')
  if (current !== -1) return current
  if (statuses.every(status => status === 'completed')) return statuses.length - 1
  const stopped = statuses.indexOf('interrupted')
  if (stopped !== -1) return stopped
  const pending = statuses.indexOf('pending')
  if (pending !== -1) return pending
  return statuses.length - 1
}

export function isRailNodeReached(status: TaskRailStatus): boolean {
  return status === 'completed' || status === 'in_progress'
}

/** Y grows along the rail, so the length at a node is a binary search over getPointAtLength. */
export function lengthAtY(path: PointSampler, y: number): number {
  const total = path.getTotalLength()
  if (!(total > 0)) return 0
  let low = 0
  let high = total
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2
    if (path.getPointAtLength(mid).y < y) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** Paper-plane heading: path tangent plus 90°, because the glyph points up at 0°. */
export function tangentAngle(path: PointSampler, length: number): number {
  const total = path.getTotalLength()
  if (!(total > 0)) return 180
  const delta = Math.min(0.5, total / 2)
  const start = path.getPointAtLength(Math.max(0, Math.min(total, length - delta)))
  const end = path.getPointAtLength(Math.max(0, Math.min(total, length + delta)))
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return 180
  return Math.atan2(dy, dx) * (180 / Math.PI) + 90
}
