/** SVG path data, flattened to lines and cubics. Coordinates stay in the caller's units. */

export type PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' }

type Point = { x: number; y: number }

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g

export function parseSvgPath(d: string): PathCommand[] {
  const tokens: Array<string | number> = []
  const pattern = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(d))) tokens.push(match[1] ?? Number(match[2]))
  const commands: PathCommand[] = []
  let index = 0
  let command = ''
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prevCubic: Point | null = null
  let prevQuad: Point | null = null

  const read = (): number => {
    const value = tokens[index++]
    return typeof value === 'number' ? value : 0
  }
  const hasNumber = (): boolean => typeof tokens[index] === 'number'

  while (index < tokens.length) {
    if (typeof tokens[index] === 'string') command = String(tokens[index++])
    if (!command) break
    const relative = command === command.toLowerCase()
    const op = command.toUpperCase()
    if (op !== 'C' && op !== 'S') prevCubic = null
    if (op !== 'Q' && op !== 'T') prevQuad = null
    if (op === 'Z') {
      commands.push({ op: 'Z' })
      cx = sx
      cy = sy
      if (typeof tokens[index] === 'string') continue
      continue
    }
    if (op === 'M') {
      let first = true
      while (hasNumber()) {
        const x = read() + (relative ? cx : 0)
        const y = read() + (relative ? cy : 0)
        commands.push({ op: first ? 'M' : 'L', x, y })
        cx = x
        cy = y
        if (first) {
          sx = x
          sy = y
        }
        first = false
      }
      continue
    }
    if (op === 'L') {
      while (hasNumber()) {
        cx = read() + (relative ? cx : 0)
        cy = read() + (relative ? cy : 0)
        commands.push({ op: 'L', x: cx, y: cy })
      }
      continue
    }
    if (op === 'H') {
      while (hasNumber()) {
        cx = read() + (relative ? cx : 0)
        commands.push({ op: 'L', x: cx, y: cy })
      }
      continue
    }
    if (op === 'V') {
      while (hasNumber()) {
        cy = read() + (relative ? cy : 0)
        commands.push({ op: 'L', x: cx, y: cy })
      }
      continue
    }
    if (op === 'C') {
      while (hasNumber()) {
        const x1 = read() + (relative ? cx : 0)
        const y1 = read() + (relative ? cy : 0)
        const x2 = read() + (relative ? cx : 0)
        const y2 = read() + (relative ? cy : 0)
        const x = read() + (relative ? cx : 0)
        const y = read() + (relative ? cy : 0)
        commands.push({ op: 'C', x1, y1, x2, y2, x, y })
        prevCubic = { x: x2, y: y2 }
        cx = x
        cy = y
      }
      continue
    }
    if (op === 'S') {
      while (hasNumber()) {
        const reflected = reflect(prevCubic, cx, cy)
        const x1 = reflected.x
        const y1 = reflected.y
        const x2 = read() + (relative ? cx : 0)
        const y2 = read() + (relative ? cy : 0)
        const x = read() + (relative ? cx : 0)
        const y = read() + (relative ? cy : 0)
        commands.push({ op: 'C', x1, y1, x2, y2, x, y })
        prevCubic = { x: x2, y: y2 }
        cx = x
        cy = y
      }
      continue
    }
    if (op === 'Q') {
      while (hasNumber()) {
        const x1 = read() + (relative ? cx : 0)
        const y1 = read() + (relative ? cy : 0)
        const x = read() + (relative ? cx : 0)
        const y = read() + (relative ? cy : 0)
        commands.push(quadToCubic(cx, cy, x1, y1, x, y))
        prevQuad = { x: x1, y: y1 }
        cx = x
        cy = y
      }
      continue
    }
    if (op === 'T') {
      while (hasNumber()) {
        const reflected = reflect(prevQuad, cx, cy)
        const x = read() + (relative ? cx : 0)
        const y = read() + (relative ? cy : 0)
        commands.push(quadToCubic(cx, cy, reflected.x, reflected.y, x, y))
        prevQuad = reflected
        cx = x
        cy = y
      }
      continue
    }
    if (op === 'A') {
      while (hasNumber()) {
        const rx = read()
        const ry = read()
        const angle = read()
        const large = read()
        const sweep = read()
        const x = read() + (relative ? cx : 0)
        const y = read() + (relative ? cy : 0)
        commands.push(...arcToCubics(cx, cy, rx, ry, angle, large, sweep, x, y))
        cx = x
        cy = y
      }
      continue
    }
    break
  }
  return commands
}

function reflect(control: Point | null, x: number, y: number): Point {
  if (!control) return { x, y }
  return { x: 2 * x - control.x, y: 2 * y - control.y }
}

function quadToCubic(x0: number, y0: number, x1: number, y1: number, x: number, y: number): PathCommand {
  return {
    op: 'C',
    x1: x0 + (2 / 3) * (x1 - x0),
    y1: y0 + (2 / 3) * (y1 - y0),
    x2: x + (2 / 3) * (x1 - x),
    y2: y + (2 / 3) * (y1 - y),
    x,
    y,
  }
}

function arcToCubics(x1: number, y1: number, rx: number, ry: number, angle: number, large: number, sweep: number, x2: number, y2: number): PathCommand[] {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [{ op: 'L', x: x2, y: y2 }]
  const phi = (angle * Math.PI) / 180
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy
  let radiusX = Math.abs(rx)
  let radiusY = Math.abs(ry)
  const lambda = (x1p * x1p) / (radiusX * radiusX) + (y1p * y1p) / (radiusY * radiusY)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    radiusX *= scale
    radiusY *= scale
  }
  const sign = (large === 0) === (sweep === 0) ? -1 : 1
  const numerator = radiusX * radiusX * radiusY * radiusY - radiusX * radiusX * y1p * y1p - radiusY * radiusY * x1p * x1p
  const denominator = radiusX * radiusX * y1p * y1p + radiusY * radiusY * x1p * x1p
  const coef = sign * Math.sqrt(Math.max(0, numerator / denominator))
  const cxp = coef * ((radiusX * y1p) / radiusY)
  const cyp = coef * ((-radiusY * x1p) / radiusX)
  const centerX = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const centerY = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
  const start = vectorAngle((x1p - cxp) / radiusX, (y1p - cyp) / radiusY)
  let delta = vectorAngle((-x1p - cxp) / radiusX, (-y1p - cyp) / radiusY) - start
  if (sweep === 0 && delta > 0) delta -= Math.PI * 2
  if (sweep !== 0 && delta < 0) delta += Math.PI * 2
  const curves: PathCommand[] = []
  const slices = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
  for (let slice = 0; slice < slices; slice++) {
    const theta1 = start + (delta * slice) / slices
    const step = delta / slices
    curves.push(arcSlice(centerX, centerY, radiusX, radiusY, phi, theta1, step))
  }
  return curves
}

function vectorAngle(ux: number, uy: number): number {
  return Math.atan2(uy, ux)
}

function arcSlice(cx: number, cy: number, rx: number, ry: number, phi: number, theta1: number, delta: number): PathCommand {
  const alpha = (Math.sin(delta) * (Math.sqrt(4 + 3 * Math.tan(delta / 2) ** 2) - 1)) / 3
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const point = (theta: number) => {
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    return {
      x: cx + rx * cosPhi * cos - ry * sinPhi * sin,
      y: cy + rx * sinPhi * cos + ry * cosPhi * sin,
      dx: -rx * cosPhi * sin - ry * sinPhi * cos,
      dy: -rx * sinPhi * sin + ry * cosPhi * cos,
    }
  }
  const p1 = point(theta1)
  const p2 = point(theta1 + delta)
  return {
    op: 'C',
    x1: p1.x + alpha * p1.dx,
    y1: p1.y + alpha * p1.dy,
    x2: p2.x - alpha * p2.dx,
    y2: p2.y - alpha * p2.dy,
    x: p2.x,
    y: p2.y,
  }
}

export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function multiply(parent: Matrix, child: Matrix): Matrix {
  const [a, b, c, d, e, f] = parent
  const [a2, b2, c2, d2, e2, f2] = child
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ]
}

export function apply(matrix: Matrix, x: number, y: number): Point {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }
}

export function parseTransform(value: string | null | undefined): Matrix {
  if (!value) return IDENTITY
  let matrix: Matrix = IDENTITY
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    const numbers = match[2]!.match(NUMBER)?.map(Number) ?? []
    matrix = multiply(matrix, transformPart(match[1]!, numbers))
  }
  return matrix
}

function transformPart(name: string, numbers: number[]): Matrix {
  if (name === 'matrix' && numbers.length >= 6) return numbers.slice(0, 6) as Matrix
  if (name === 'translate') return [1, 0, 0, 1, numbers[0] ?? 0, numbers[1] ?? 0]
  if (name === 'scale') return [numbers[0] ?? 1, 0, 0, numbers[1] ?? numbers[0] ?? 1, 0, 0]
  if (name === 'rotate') {
    const radians = ((numbers[0] ?? 0) * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const rotation: Matrix = [cos, sin, -sin, cos, 0, 0]
    if (numbers.length >= 3) {
      const cx = numbers[1] ?? 0
      const cy = numbers[2] ?? 0
      return multiply(multiply([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy])
    }
    return rotation
  }
  if (name === 'skewX') return [1, 0, Math.tan(((numbers[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
  if (name === 'skewY') return [1, Math.tan(((numbers[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
  return IDENTITY
}

export function isAxisAligned(matrix: Matrix): boolean {
  return Math.abs(matrix[1]) < 1e-4 && Math.abs(matrix[2]) < 1e-4
}

export function transformCommands(commands: PathCommand[], matrix: Matrix): PathCommand[] {
  return commands.map(command => {
    if (command.op === 'Z') return command
    if (command.op === 'C') {
      const p1 = apply(matrix, command.x1, command.y1)
      const p2 = apply(matrix, command.x2, command.y2)
      const p = apply(matrix, command.x, command.y)
      return { op: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y }
    }
    const point = apply(matrix, command.x, command.y)
    return { op: command.op, x: point.x, y: point.y }
  })
}

export function commandBounds(commands: PathCommand[], pad = 0): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const command of commands) {
    if (command.op === 'Z') continue
    const points = command.op === 'C'
      ? [[command.x1, command.y1], [command.x2, command.y2], [command.x, command.y]]
      : [[command.x, command.y]]
    for (const [x, y] of points) {
      minX = Math.min(minX, x!)
      minY = Math.min(minY, y!)
      maxX = Math.max(maxX, x!)
      maxY = Math.max(maxY, y!)
    }
  }
  if (!Number.isFinite(minX)) return null
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(0.5, maxX - minX + pad * 2),
    h: Math.max(0.5, maxY - minY + pad * 2),
  }
}

export function localizeCommands(commands: PathCommand[], originX: number, originY: number): PathCommand[] {
  return commands.map(command => {
    if (command.op === 'Z') return command
    if (command.op === 'C') {
      return {
        op: 'C',
        x1: command.x1 - originX,
        y1: command.y1 - originY,
        x2: command.x2 - originX,
        y2: command.y2 - originY,
        x: command.x - originX,
        y: command.y - originY,
      }
    }
    return { op: command.op, x: command.x - originX, y: command.y - originY }
  })
}

export function commandsToPath(commands: PathCommand[]): string {
  return commands.map(command => {
    if (command.op === 'Z') return 'Z'
    if (command.op === 'C') return `C ${n(command.x1)} ${n(command.y1)} ${n(command.x2)} ${n(command.y2)} ${n(command.x)} ${n(command.y)}`
    return `${command.op} ${n(command.x)} ${n(command.y)}`
  }).join(' ')
}

function n(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

export type DrawingPoint =
  | { x: number; y: number; moveTo?: boolean }
  | { x: number; y: number; curve: { type: 'cubic'; x1: number; y1: number; x2: number; y2: number } }
  | { close: true }

/** Path `d` is in points, local to the shape. Points come back in inches for pptxgenjs. */
export function pathToDrawingPoints(d: string): DrawingPoint[] {
  const points: DrawingPoint[] = []
  for (const command of parseSvgPath(d)) {
    if (command.op === 'Z') {
      points.push({ close: true })
      continue
    }
    if (command.op === 'M') {
      points.push({ x: inches(command.x), y: inches(command.y), moveTo: true })
      continue
    }
    if (command.op === 'C') {
      points.push({
        x: inches(command.x),
        y: inches(command.y),
        curve: { type: 'cubic', x1: inches(command.x1), y1: inches(command.y1), x2: inches(command.x2), y2: inches(command.y2) },
      })
      continue
    }
    points.push({ x: inches(command.x), y: inches(command.y) })
  }
  return points
}

function inches(points: number): number {
  return points / 72
}
