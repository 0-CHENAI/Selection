import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { HelpCircleIcon } from '@hugeicons/core-free-icons'
import { Item as MenuItem } from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { type ThinkingLevel, type ThinkingLevelDefinition, getThinkingLevelNameKey } from '@craft-agent/shared/agent/thinking-levels'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import { useWebglEffort } from '@/hooks/useWebglEffort'
import { EFFORT_FIELD_FADE_MS } from './effort-theme'
import { mountPromptSparks } from './prompt-sparks'
import './PromptBarEffects.css'

// Keep the handle centered on each stop, including both track endpoints.
const EFFORT_THUMB = 26
const EFFORT_EDGE = EFFORT_THUMB / 2

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(prefersReducedMotion)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    const sync = () => setReduced(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return reduced
}

/** Keep the canvas through the fade-out, then drop it so WebGL can tear down. */
function useMaxEffortPresence(active: boolean) {
  const reducedMotion = usePrefersReducedMotion()
  const [present, setPresent] = React.useState(active)
  const [visible, setVisible] = React.useState(() => active && prefersReducedMotion())
  const presentRef = React.useRef(present)
  presentRef.current = present

  React.useEffect(() => {
    if (active) {
      setPresent(true)
      if (reducedMotion) {
        setVisible(true)
        return
      }
      setVisible(false)
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(outer)
        if (inner) cancelAnimationFrame(inner)
      }
    }
    setVisible(false)
    if (!presentRef.current) return
    if (reducedMotion) {
      setPresent(false)
      return
    }
    const timer = window.setTimeout(() => setPresent(false), EFFORT_FIELD_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [active, reducedMotion])

  return { present, visible }
}

function MaxEffortField({ visible }: { visible: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  useWebglEffort(canvasRef)
  return <canvas ref={canvasRef} className="prompt-effort-webgl" data-visible={visible || undefined} aria-hidden="true" />
}

export function PromptThinkingSettings({
  value, levels, workMode, disabled, onChange, unavailable, binary, inMenu = true, headingAction,
}: {
  value: ThinkingLevel
  levels: readonly ThinkingLevelDefinition[]
  workMode?: WorkMode
  disabled?: boolean
  onChange: (level: ThinkingLevel) => void
  /** Hide the slider and explain why this model has no effort scale. */
  unavailable?: 'unsupported' | 'always-on'
  /** Two stops that only turn thinking on or off. */
  binary?: boolean
  /** Drawer controls are not descendants of a Radix dropdown menu. */
  inMenu?: boolean
  headingAction?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [dragging, setDragging] = React.useState(false)
  const maxed = !unavailable && !disabled && levels.length > 1 && value === levels.at(-1)?.id
  const maxField = useMaxEffortPresence(maxed)
  if (unavailable) {
    const note = unavailable === 'always-on' ? 'thinking.alwaysOn' : 'thinking.notSupported'
    return (
      <div className="prompt-effort-settings" data-thinking-mode={unavailable} data-work-mode={workMode}>
        <div className="prompt-effort-heading">
          <span className="text-muted-foreground">{t('thinking.effort')}</span>
          <span className="prompt-effort-value font-medium">{t(unavailable === 'always-on' ? 'thinking.alwaysOnShort' : 'thinking.notSupported')}</span>
          {headingAction && <span className="prompt-effort-action">{headingAction}</span>}
        </div>
        <p className="prompt-effort-note text-muted-foreground">{t(note)}</p>
      </div>
    )
  }
  const index = Math.max(0, levels.findIndex(level => level.id === value))
  const valueKey = binary ? (value === 'off' ? 'thinking.off' : 'thinking.on') : getThinkingLevelNameKey(value)
  if (levels.length === 0) return null
  const inactive = disabled || levels.length === 1
  const stopDragging = () => setDragging(false)
  const stepAt = (i: number) => `calc(${EFFORT_EDGE}px + (100% - ${EFFORT_EDGE * 2}px) * ${i / Math.max(1, levels.length - 1)})`
  const setIndex = (next: number) => {
    if (inactive) return
    const level = levels[Math.max(0, Math.min(levels.length - 1, next))]!
    if (level.id !== value) onChange(level.id)
  }
  const fromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (inactive) return
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientX - rect.left - EFFORT_EDGE) / Math.max(1, rect.width - EFFORT_EDGE * 2)
    setIndex(Math.round(fraction * (levels.length - 1)))
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (inactive) return
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    event.stopPropagation()
    setIndex(step ? index + step : event.key === 'Home' ? 0 : levels.length - 1)
  }
  const helpButton = (
    <button type="button" className="prompt-effort-help" aria-label={t('thinking.effortHelp')}>
      <HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
  const slider = (
    <div
      className="prompt-effort-track"
      role="slider"
      tabIndex={inactive ? -1 : 0}
      aria-label={t('thinking.effort')}
      aria-description={t('thinking.effortHelp')}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={levels.length - 1}
      aria-valuenow={index}
      aria-valuetext={t(valueKey)}
      aria-disabled={inactive}
      data-dragging={dragging || undefined}
      style={{
        '--prompt-effort-x': stepAt(index),
        '--prompt-effort-thumb': `${EFFORT_THUMB}px`,
        '--prompt-effort-fill': index === levels.length - 1 ? '100%' : `calc(${stepAt(index)} + ${EFFORT_THUMB / 2}px)`,
      } as React.CSSProperties}
      onPointerDown={event => {
        if (event.button !== 0 || inactive) return
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus({ preventScroll: true })
        setDragging(true)
        fromPointer(event)
      }}
      onPointerMove={event => { if (event.buttons & 1) fromPointer(event) }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={onKeyDown}
    >
      <span className="prompt-effort-fill" aria-hidden="true" />
      {levels.map((level, i) => <i key={level.id} className="prompt-effort-dot" style={{ left: stepAt(i) }} aria-hidden="true" />)}
      {maxField.present && <MaxEffortField visible={maxField.visible} />}
      <span className="prompt-effort-thumb" aria-hidden="true" />
    </div>
  )

  return (
    <div className="prompt-effort-settings" data-max={maxed || undefined} data-work-mode={workMode}>
      <div className="prompt-effort-heading">
        <span className="text-muted-foreground">{t('thinking.effort')}</span>
        <span className="prompt-effort-value font-medium">{t(valueKey)}</span>
        {headingAction ? <span className="prompt-effort-action">{headingAction}</span> : <Tooltip>
          <TooltipTrigger asChild>
            {inMenu
              ? <MenuItem asChild onSelect={event => event.preventDefault()}>{helpButton}</MenuItem>
              : helpButton}
          </TooltipTrigger>
          <TooltipContent>{t('thinking.effortHelp')}</TooltipContent>
        </Tooltip>}
      </div>
      {binary && levels.length > 1 && <div className="prompt-effort-endpoints text-muted-foreground">
        <span>{t('thinking.off')}</span>
        <span>{t('thinking.on')}</span>
      </div>}
      {levels.length > 1 && (inMenu
        ? <MenuItem asChild disabled={inactive} onSelect={event => event.preventDefault()}>{slider}</MenuItem>
        : slider)}
    </div>
  )
}

export function PromptSparks({ active, energy }: { active: boolean; energy: React.MutableRefObject<number> }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!active || reducedMotion || !canvas) return
    return mountPromptSparks(canvas, { energy, reducedMotion: !!reducedMotion })
  }, [active, energy, reducedMotion])

  if (!active || reducedMotion) return null
  return <canvas ref={canvasRef} className="prompt-sparks" aria-hidden="true" />
}
