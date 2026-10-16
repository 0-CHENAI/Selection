import * as React from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import {
  OPEN_NODE_RADIUS,
  RAIL_NODE_HOLE,
  RAIL_STROKE,
  RAIL_TRAVEL_SPRING,
  RAIL_TURN_SPRING,
  REACHED_NODE_RADIUS,
  buildRailPath,
  isRailNodeReached,
  lengthAtY,
  railLabelPadding,
  railNodeX,
  railTargetIndex,
  tangentAngle,
  type RailNode,
  type TaskRailStatus,
} from './task-rail'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface TaskRailItem {
  id?: string
  content: string
  status: TaskRailStatus
  activeForm?: string
  /** Heading depth. Conversation tasks are flat, so this stays 0. */
  depth?: number
}

interface TaskRailProps {
  items: readonly TaskRailItem[]
}

const STATUSES = ['in_progress', 'pending', 'completed', 'interrupted'] as const

function summaryLabel(
  items: readonly TaskRailItem[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (items.length > 0 && items.every(item => item.status === 'completed')) return t('taskList.allCompleted')
  return STATUSES
    .filter(status => items.some(item => item.status === status))
    .map(status => t(`taskList.count.${status}`, { count: items.filter(item => item.status === status).length }))
    .join(' · ')
}

/**
 * Read-only rail for conversation task progress.
 * Task status drives the plane; nothing is clickable or hoverable.
 */
export function TaskRail({ items }: TaskRailProps) {
  const { t } = useTranslation()
  const reduceMotion = !!useReducedMotion()
  const titleId = useId()
  const uid = titleId.replace(/:/g, '')
  const fadeId = `rail-fade-${uid}`
  const railMaskId = `rail-mask-${uid}`
  const nodeMaskId = `rail-nodes-${uid}`
  const listRef = useRef<HTMLOListElement>(null)
  const itemRefs = useRef<Array<HTMLLIElement | null>>([])
  const pathRef = useRef<SVGPathElement>(null)
  const planeRef = useRef<SVGGElement>(null)
  const railHoleRef = useRef<SVGCircleElement>(null)
  const nodeHoleRef = useRef<SVGCircleElement>(null)
  const signatureRef = useRef('')
  const placedRef = useRef(false)
  const instantRef = useRef(true)
  const angleTargetRef = useRef<number | null>(null)
  const pointRef = useRef({ x: 0, y: 0 })
  const [nodes, setNodes] = useState<RailNode[]>([])
  const [box, setBox] = useState({ width: 0, height: 0 })

  const lengthMv = useSpring(0, RAIL_TRAVEL_SPRING)
  const rotateMv = useSpring(180, RAIL_TURN_SPRING)
  const progressMv = useMotionValue(0)

  const paint = (point: { x: number; y: number }, angle: number, visible: boolean) => {
    pointRef.current = point
    planeRef.current?.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${angle})`)
    planeRef.current?.setAttribute('opacity', visible ? '1' : '0')
    for (const hole of [railHoleRef.current, nodeHoleRef.current]) {
      hole?.setAttribute('cx', String(point.x))
      hole?.setAttribute('cy', String(point.y))
    }
  }

  useMotionValueEvent(lengthMv, 'change', (len) => {
    const path = pathRef.current
    if (!path) return
    const total = path.getTotalLength()
    if (!(total > 0)) return
    const clamped = Math.max(0, Math.min(total, len))
    const point = path.getPointAtLength(clamped)
    const angle = tangentAngle(path, clamped)
    if (angleTargetRef.current === null || Math.abs(angle - angleTargetRef.current) > 0.1) {
      angleTargetRef.current = angle
      if (instantRef.current) rotateMv.jump(angle)
      else rotateMv.set(angle)
    }
    progressMv.set(clamped / total)
    paint(point, instantRef.current ? angle : rotateMv.get(), true)
  })

  useMotionValueEvent(rotateMv, 'change', (angle) => {
    const path = pathRef.current
    if (!path || path.getTotalLength() <= 0) return
    paint(pointRef.current, angle, placedRef.current)
  })

  const measure = React.useCallback(() => {
    const list = listRef.current
    if (!list) return
    const listRect = list.getBoundingClientRect()
    const next = items.map((item, index) => {
      const element = itemRefs.current[index]
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        x: railNodeX(item.depth ?? 0),
        y: rect.top - listRect.top + rect.height / 2,
      }
    }).filter((node): node is RailNode => node !== null)
    const signature = `${listRect.width.toFixed(2)}x${listRect.height.toFixed(2)}|${next.map(node => `${node.x.toFixed(2)},${node.y.toFixed(2)}`).join(';')}`
    if (signature === signatureRef.current) return
    signatureRef.current = signature
    setNodes(next)
    setBox({ width: listRect.width, height: listRect.height })
  }, [items])

  useIsoLayoutEffect(() => {
    measure()
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(list)
    for (const element of itemRefs.current) {
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [measure])

  const targetIndex = railTargetIndex(items.map(item => item.status))
  const pathD = buildRailPath(nodes)

  useIsoLayoutEffect(() => {
    const path = pathRef.current
    const target = nodes[targetIndex]
    if (!path || !target || path.getTotalLength() <= 0) return
    const nextLength = lengthAtY(path, target.y)
    instantRef.current = reduceMotion || !placedRef.current
    if (instantRef.current) lengthMv.jump(nextLength)
    else lengthMv.set(nextLength)
    placedRef.current = true
    instantRef.current = reduceMotion
  }, [lengthMv, nodes, pathD, reduceMotion, targetIndex])

  if (items.length === 0) return null

  const summary = summaryLabel(items, t)
  const firstY = nodes[0]?.y ?? 0
  const maskWidth = Math.max(box.width, 1)
  const maskHeight = Math.max(box.height, 1)

  return (
    <section
      aria-labelledby={titleId}
      data-task-rail=""
      data-readonly="true"
      className="task-rail relative mt-3 select-text"
      style={{ ['--rail' as string]: 'color-mix(in oklab, var(--foreground) 45%, var(--background))' }}
    >
      <div id={titleId} className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground/70">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
          <path d="M2 4.25h12M2 8h12M2 11.75h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>{t('taskList.title')}</span>
      </div>
      <p className="sr-only" aria-live="polite">{summary}</p>
      <div className="relative">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={fadeId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={Math.max(firstY, 1)}>
              <stop offset="0%" stopColor="black" />
              <stop offset="100%" stopColor="white" />
            </linearGradient>
            <mask id={railMaskId} maskUnits="userSpaceOnUse" x="-16" y="-16" width={maskWidth + 32} height={maskHeight + 32}>
              <rect x="-16" y="-16" width={maskWidth + 32} height={maskHeight + 32} fill={`url(#${fadeId})`} />
              {nodes.map((node, index) => (
                <circle key={`hole-${index}`} cx={node.x} cy={node.y} r={RAIL_NODE_HOLE} fill="black" />
              ))}
              <circle ref={railHoleRef} cx={-20} cy={-20} r={RAIL_NODE_HOLE} fill="black" />
            </mask>
            <mask id={nodeMaskId} maskUnits="userSpaceOnUse" x="-16" y="-16" width={maskWidth + 32} height={maskHeight + 32}>
              <rect x="-16" y="-16" width={maskWidth + 32} height={maskHeight + 32} fill="white" />
              <circle ref={nodeHoleRef} cx={-20} cy={-20} r={RAIL_NODE_HOLE} fill="black" />
            </mask>
          </defs>
          <path
            ref={pathRef}
            d={pathD}
            fill="none"
            stroke="currentColor"
            strokeWidth={RAIL_STROKE}
            strokeDasharray="2 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-foreground/25"
            mask={`url(#${railMaskId})`}
          />
          <motion.path
            d={pathD}
            fill="none"
            stroke="var(--rail)"
            strokeWidth={RAIL_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={progressMv}
            mask={`url(#${railMaskId})`}
          />
          <g mask={`url(#${nodeMaskId})`}>
            {nodes.map((node, index) => {
              const status = items[index]?.status ?? 'pending'
              const reached = isRailNodeReached(status)
              const stopped = status === 'interrupted'
              return (
                <circle
                  key={`node-${items[index]?.id ?? index}`}
                  cx={node.x}
                  cy={node.y}
                  r={reached ? REACHED_NODE_RADIUS : OPEN_NODE_RADIUS}
                  fill={reached ? 'var(--rail)' : 'transparent'}
                  stroke={stopped ? 'var(--destructive)' : reached ? 'var(--rail)' : 'color-mix(in oklab, var(--foreground) 30%, transparent)'}
                  strokeWidth={RAIL_STROKE}
                  data-task-node={status}
                  style={{ transition: reduceMotion ? 'none' : 'fill 200ms, stroke 200ms, r 200ms' }}
                />
              )
            })}
          </g>
          <g ref={planeRef} opacity="0" className="text-foreground">
            <path
              d="M12 2 20.5 21 12 17.5 3.5 21z"
              transform="translate(-12 -12) scale(0.666667)"
              fill="currentColor"
              style={{ filter: 'drop-shadow(0 0 2px rgb(0 0 0 / .35))' }}
            />
          </g>
        </svg>
        <ol ref={listRef} className="relative m-0 list-none p-0">
          {items.map((item, index) => {
            const current = index === targetIndex
            const depth = item.depth ?? 0
            const text = item.status === 'in_progress' && item.activeForm ? item.activeForm : item.content
            return (
              <li
                key={item.id ?? `${item.content}-${index}`}
                ref={(element) => { itemRefs.current[index] = element }}
                data-task-status={item.status}
                data-task-depth={depth}
                aria-current={current ? 'step' : undefined}
                className="py-1.5 text-sm leading-5"
                style={{ paddingLeft: railLabelPadding(depth) }}
              >
                <span className="sr-only">{t(`taskList.status.${item.status}`)}. </span>
                <span className={cn(
                  'whitespace-pre-wrap break-words transition-colors duration-200 motion-reduce:transition-none',
                  item.status === 'interrupted'
                    ? cn('line-through decoration-destructive/50', current ? 'font-medium text-destructive' : 'text-destructive/70')
                    : current ? 'font-medium text-foreground' : 'text-foreground/50',
                )}>
                  {text}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
