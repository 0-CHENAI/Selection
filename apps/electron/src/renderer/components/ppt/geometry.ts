export const CARD_WIDTH = 124
export const CARD_HEIGHT = CARD_WIDTH * 9 / 16
export const FAN = [{ r: 8, x: 12, y: -3 }, { r: 4, x: 6, y: -1.5 }] as const
export const CTRL = { size: 20, xOff: 8, menuOff: 9 }
export const VISUAL_GAP = 10
export const ROW_GAP = 8
export const TILT_SLOT_PAD = { left: 2, top: 20, bottom: 12 }

/** Union of cover, inner pages and controls at rest and maximal hover. */
export function tiltExtent(width: number) {
  const height = width * 9 / 16
  type Point = [number, number]
  const rotate = (p: Point, origin: Point, degrees: number): Point => {
    const angle = degrees * Math.PI / 180
    const x = p[0] - origin[0], y = p[1] - origin[1]
    return [origin[0] + x * Math.cos(angle) - y * Math.sin(angle), origin[1] + x * Math.sin(angle) + y * Math.cos(angle)]
  }
  const corners: Point[] = [[0, 0], [width, 0], [width, height], [0, height]]
  const local = [...corners]
  for (const fan of FAN) for (const point of corners) {
    const p = rotate(point, [width * .2, height * .8], fan.r)
    local.push([p[0] + fan.x, p[1] + fan.y])
  }
  const radius = CTRL.size / 2
  const circles: Point[] = [[width + CTRL.xOff - radius, -CTRL.xOff + radius], [width + CTRL.menuOff - radius, height + CTRL.menuOff - radius]]
  let right = -Infinity, left = Infinity, top = Infinity, bottom = -Infinity
  for (const [degrees, scale] of [[-3, 1], [-1.5, 1.03]] as const) {
    const center: Point = [width / 2, height / 2]
    const transform = (p: Point): Point => {
      const q = rotate(p, center, degrees)
      return [center[0] + (q[0] - center[0]) * scale, center[1] + (q[1] - center[1]) * scale]
    }
    for (const [points, padding] of [[local, 0], [circles, radius * scale]] as const) for (const point of points) {
      const q = transform(point)
      right = Math.max(right, q[0] + padding); left = Math.min(left, q[0] - padding)
      top = Math.min(top, q[1] - padding); bottom = Math.max(bottom, q[1] + padding)
    }
  }
  return { right, left, top, bottom, overhangRight: right - width, overhangTop: -top }
}
export function attachTrail(width = CARD_WIDTH) {
  return Math.ceil(tiltExtent(width).overhangRight + VISUAL_GAP - ROW_GAP)
}
