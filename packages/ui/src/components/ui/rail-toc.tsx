// Rail TOC from rare-ui (swamimalode07/rare-ui/rail-toc).
// Display only: task status parks the plane. The original section links are omitted.

import * as React from "react"
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
} from "motion/react"

import { cn } from "../../lib/utils"

export type RailTocStatus = "pending" | "in_progress" | "completed" | "interrupted"

export type RailTocItem = {
  id: string
  label: string
  depth?: number
  status?: RailTocStatus
  statusLabel?: string
}

const RAIL_X = 5
const LABEL_GAP = 14
const TRAVEL_SPRING = { stiffness: 140, damping: 26, mass: 0.6 }
const TURN_SPRING = { stiffness: 260, damping: 30 }
// rail length the plane must back up before it turns around
const TURN_SLACK = 2

const PLANE = "M12 2 20.5 21 12 17.5 3.5 21z"
// the plane is narrower than a dot, so the rail and dots under it are cut away
const PLANE_HOLE = 4

const useIsoLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

type Point = { x: number; y: number }
type Geometry = { nodes: Point[]; d: string; width: number; height: number }

function buildPath(nodes: Point[]) {
  const first = nodes[0]
  if (!first) return ""
  const points: Point[] = [{ x: first.x, y: 0 }, first]
  for (let i = 1; i < nodes.length; i++) {
    const from = nodes[i - 1]
    const to = nodes[i]
    if (!from || !to) continue
    if (from.x !== to.x) {
      const bend = (to.y - from.y) * 0.3
      points.push({ x: from.x, y: from.y + bend }, { x: to.x, y: to.y - bend })
    }
    points.push(to)
  }
  return points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")
}

// the rail only ever runs downward, so y is monotonic along its length
function lengthAtY(path: SVGPathElement, total: number, y: number) {
  let lo = 0
  let hi = total
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (path.getPointAtLength(mid).y < y) lo = mid
    else hi = mid
  }
  return hi
}

/** In-progress step, or the last step when every item is completed. Otherwise none. */
export function railTocActiveIndex(items: readonly { status?: RailTocStatus }[]): number {
  if (items.length === 0) return -1
  const current = items.findIndex((item) => item.status === "in_progress")
  if (current !== -1) return current
  if (items.every((item) => item.status === "completed")) return items.length - 1
  return -1
}

export type RailTocProps = Omit<React.ComponentProps<"section">, "title"> & {
  items: RailTocItem[]
  indent?: number
  title?: string
  liveSummary?: string
}

const RailToc = ({
  className,
  items,
  indent = 14,
  title = "On this page",
  liveSummary,
  ...props
}: RailTocProps) => {
  const reduceMotion = useReducedMotion()
  const titleId = React.useId()
  const maskId = `rail-toc-${titleId.replace(/[^\w-]/g, "")}`

  const listRef = React.useRef<HTMLUListElement>(null)
  const rowRefs = React.useRef<(HTMLLIElement | null)[]>([])
  const pathRef = React.useRef<SVGPathElement>(null)
  const holeRefs = React.useRef<(SVGCircleElement | null)[]>([])
  const signatureRef = React.useRef("")

  const [geometry, setGeometry] = React.useState<Geometry>()

  const lengths = React.useRef<number[]>([])
  const total = React.useRef(0)
  const placed = React.useRef(false)
  const facing = React.useRef<1 | -1>(1)
  const turnFrom = React.useRef(0)

  const target = useMotionValue(0)
  const travel = useSpring(target, TRAVEL_SPRING)
  const distance = reduceMotion ? target : travel

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const heading = useMotionValue(180)
  const turn = useSpring(heading, TURN_SPRING)
  const filled = useMotionValue(0)

  const activeIndex = railTocActiveIndex(items)

  const pose = React.useCallback(
    (l: number) => {
      const path = pathRef.current
      const length = total.current
      if (!path || !length) return
      const at = path.getPointAtLength(l)
      const behind = path.getPointAtLength(Math.max(0, l - 1))
      const ahead = path.getPointAtLength(Math.min(length, l + 1))
      x.set(at.x)
      holeRefs.current.forEach((hole) => {
        hole?.setAttribute("cx", `${at.x}`)
        hole?.setAttribute("cy", `${at.y}`)
      })
      y.set(at.y)
      const angle =
        (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI +
        90 +
        (facing.current < 0 ? 180 : 0)
      // unwrapped against the current heading so the turn spring takes the short way round
      const prev = heading.get()
      heading.set(angle + 360 * Math.round((prev - angle) / 360))
      filled.set(l / length)
    },
    [x, y, heading, filled],
  )

  useMotionValueEvent(distance, "change", pose)

  const aim = React.useCallback(
    (next: number) => {
      const from = turnFrom.current
      if ((next - from) * facing.current > 0) turnFrom.current = next
      else if (Math.abs(next - from) > TURN_SLACK) {
        facing.current = facing.current > 0 ? -1 : 1
        turnFrom.current = next
      }
      target.set(next)
    },
    [target],
  )

  useIsoLayoutEffect(() => {
    const list = listRef.current
    if (!list || !items.length) return

    const measure = () => {
      const nodes: Point[] = []
      for (let i = 0; i < items.length; i++) {
        const row = rowRefs.current[i]
        const item = items[i]
        // A missing row would pin later nodes to the wrong step.
        if (!row || !item) return
        nodes.push({
          x: RAIL_X + (item.depth ?? 0) * indent,
          y: row.offsetTop + row.offsetHeight / 2,
        })
      }
      const signature = `${list.offsetWidth}x${list.offsetHeight}|${nodes.map((node) => `${node.x},${node.y}`).join(";")}`
      if (signature === signatureRef.current) return
      signatureRef.current = signature
      setGeometry({
        nodes,
        d: buildPath(nodes),
        width: Math.max(...nodes.map((n) => n.x)) + RAIL_X + 4,
        height: list.offsetHeight,
      })
    }

    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    document.fonts?.ready.then(measure).catch(() => {})
    return () => ro.disconnect()
  }, [items, indent])

  useIsoLayoutEffect(() => {
    const path = pathRef.current
    if (!path || !geometry) return
    const length = path.getTotalLength()
    total.current = length
    lengths.current = geometry.nodes.map((node) => lengthAtY(path, length, node.y))
    if (!lengths.current.length || !(length > 0)) return
    const next = activeIndex >= 0
      ? lengths.current[Math.min(activeIndex, lengths.current.length - 1)] ?? 0
      : 0
    if (!placed.current || reduceMotion) {
      placed.current = true
      target.jump(next)
      travel.jump(next)
      pose(next)
      turn.jump(heading.get())
      return
    }
    aim(next)
  }, [activeIndex, aim, geometry, heading, pose, reduceMotion, target, travel, turn])

  if (items.length === 0) return null

  const railColor =
    "[--rail:color-mix(in_oklab,var(--foreground)_45%,var(--background))]"

  return (
    <section
      data-slot="rail-toc"
      aria-labelledby={titleId}
      className={cn("w-max text-sm", railColor, className)}
      {...props}
    >
      {liveSummary ? (
        <p className="sr-only" aria-live="polite">{liveSummary}</p>
      ) : null}
      <p
        id={titleId}
        data-slot="rail-toc-title"
        className="mb-3 flex items-center gap-2 font-medium text-foreground/70"
      >
        <svg
          viewBox="0 0 16 16"
          className="-ml-0.5 h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M2 4h12M2 8h8M2 12h10" />
        </svg>
        {title}
      </p>

      <ul ref={listRef} data-slot="rail-toc-list" className="relative">
        {geometry && (
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={geometry.width}
            height={geometry.height}
            aria-hidden
          >
            <linearGradient
              id={`${maskId}-fade`}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={0}
              x2={0}
              y2={(geometry.nodes[0]?.y ?? 4) - 4}
            >
              <stop offset="0" stopColor="black" />
              <stop offset="1" stopColor="white" />
            </linearGradient>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x={-8}
              y={-8}
              width={geometry.width + 16}
              height={geometry.height + 16}
            >
              <rect
                x={-8}
                y={-8}
                width={geometry.width + 16}
                height={geometry.height + 16}
                fill={`url(#${maskId}-fade)`}
              />
              {geometry.nodes.map((node, i) => (
                <circle key={i} cx={node.x} cy={node.y} r={4} fill="black" />
              ))}
              <circle
                ref={(el) => {
                  holeRefs.current[0] = el
                }}
                r={PLANE_HOLE}
                fill="black"
              />
            </mask>
            <mask
              id={`${maskId}-nodes`}
              maskUnits="userSpaceOnUse"
              x={-8}
              y={-8}
              width={geometry.width + 16}
              height={geometry.height + 16}
            >
              <rect
                x={-8}
                y={-8}
                width={geometry.width + 16}
                height={geometry.height + 16}
                fill="white"
              />
              <circle
                ref={(el) => {
                  holeRefs.current[1] = el
                }}
                r={PLANE_HOLE}
                fill="black"
              />
            </mask>
            <g mask={`url(#${maskId})`}>
              <path
                ref={pathRef}
                d={geometry.d}
                fill="none"
                strokeWidth="1.25"
                strokeDasharray="2 5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-foreground/25"
              />
              <motion.path
                d={geometry.d}
                fill="none"
                strokeWidth="1.25"
                stroke="var(--rail)"
                strokeLinejoin="round"
                style={{ pathLength: filled }}
              />
            </g>
            <g mask={`url(#${maskId}-nodes)`}>
              {geometry.nodes.map((node, i) => {
                const status = items[i]?.status
                const filledNode = status === "completed" || status === "in_progress"
                const stopped = status === "interrupted"
                return (
                  <circle
                    key={items[i]?.id ?? i}
                    cx={node.x}
                    cy={node.y}
                    r={filledNode ? 3 : 3.25}
                    strokeWidth="1.25"
                    data-task-node={status}
                    className={cn(
                      "transition-[fill,stroke] duration-200 motion-reduce:transition-none",
                      stopped
                        ? "fill-transparent stroke-destructive"
                        : filledNode
                          ? "fill-[var(--rail)] stroke-[var(--rail)]"
                          : "fill-transparent stroke-foreground/30",
                    )}
                  />
                )
              })}
            </g>
          </svg>
        )}

        {geometry && (
          <motion.div
            data-slot="rail-toc-plane"
            className="pointer-events-none absolute left-0 top-0 -ml-2 -mt-2 h-4 w-4 text-foreground [filter:drop-shadow(0_0_2px_rgb(0_0_0/0.35))]"
            style={{ x, y, rotate: reduceMotion ? heading : turn }}
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 overflow-visible">
              <path
                d={PLANE}
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </motion.div>
        )}

        {items.map((item, i) => {
          const isActive = i === activeIndex
          const stopped = item.status === "interrupted"
          return (
            <li
              key={item.id}
              ref={(el) => {
                rowRefs.current[i] = el
              }}
              data-task-status={item.status}
              data-task-depth={item.depth ?? 0}
            >
              <span
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "block w-full py-1.5 pr-2 text-left leading-5 whitespace-pre-wrap break-words transition-colors duration-200 motion-reduce:transition-none",
                  stopped
                    ? "line-through decoration-destructive/50 text-destructive/70"
                    : isActive
                      ? "font-medium text-foreground"
                      : "text-foreground/50",
                )}
                style={{
                  paddingLeft: RAIL_X + (item.depth ?? 0) * indent + LABEL_GAP,
                }}
              >
                {item.statusLabel ? <span className="sr-only">{item.statusLabel}. </span> : null}
                {item.label}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export { RailToc }
export default RailToc
