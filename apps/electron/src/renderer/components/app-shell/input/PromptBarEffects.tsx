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
import './PromptBarEffects.css'

// Slider geometry and motion adapted from https://reactbits.dev/r/PromptBar-TS-TW.json.
const EFFORT_EDGE = 11
// Slightly larger than the 22px track so the knob reads as floating above it.
const EFFORT_THUMB = 26

function MaxEffortField() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  useWebglEffort(canvasRef)
  return <canvas ref={canvasRef} className="prompt-effort-webgl" aria-hidden="true" />
}

export function PromptThinkingSettings({
  value, levels, workMode, disabled, onChange, unavailable, binary, inMenu = true,
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
}) {
  const { t } = useTranslation()
  const [dragging, setDragging] = React.useState(false)
  if (unavailable) {
    const note = unavailable === 'always-on' ? 'thinking.alwaysOn' : 'thinking.notSupported'
    return (
      <div className="prompt-effort-settings" data-thinking-mode={unavailable} data-work-mode={workMode}>
        <div className="prompt-effort-heading">
          <span className="text-muted-foreground">{t('thinking.effort')}</span>
          <span className="prompt-effort-value font-medium">{t(unavailable === 'always-on' ? 'thinking.alwaysOnShort' : 'thinking.notSupported')}</span>
        </div>
        <p className="prompt-effort-note text-muted-foreground">{t(note)}</p>
      </div>
    )
  }
  const index = Math.max(0, levels.findIndex(level => level.id === value))
  const maxed = !binary && !disabled && levels.length > 1 && value === 'max' && levels.some(level => level.id === 'max')
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
      {maxed && <MaxEffortField />}
      <span className="prompt-effort-thumb" aria-hidden="true" />
    </div>
  )

  return (
    <div className="prompt-effort-settings" data-max={maxed || undefined} data-work-mode={workMode}>
      <div className="prompt-effort-heading">
        <span className="text-muted-foreground">{t('thinking.effort')}</span>
        <span className="prompt-effort-value font-medium">{t(valueKey)}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            {inMenu
              ? <MenuItem asChild onSelect={event => event.preventDefault()}>{helpButton}</MenuItem>
              : helpButton}
          </TooltipTrigger>
          <TooltipContent>{t('thinking.effortHelp')}</TooltipContent>
        </Tooltip>
      </div>
      <div className="prompt-effort-endpoints text-muted-foreground">
        <span>{t(binary ? 'thinking.off' : 'thinking.faster')}</span>
        <span>{t(binary ? 'thinking.on' : 'thinking.smarter')}</span>
      </div>
      {inMenu
        ? <MenuItem asChild disabled={inactive} onSelect={event => event.preventDefault()}>{slider}</MenuItem>
        : slider}
    </div>
  )
}

export function PromptSparks({ active, energy }: { active: boolean; energy: React.MutableRefObject<number> }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!active || reducedMotion || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let width = 0
    let height = 0
    let frame = 0
    let last = performance.now()
    let due = 0
    const particles: { x: number; y: number; life: number; span: number; speed: number; phase: number }[] = []
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      energy.current *= Math.exp(-dt / 0.8)
      const gain = energy.current
      due += dt
      if (due > 0.18 && particles.length < 22) {
        due = 0
        particles.push({ x: Math.random() * width, y: height + 2, life: 0, span: 3 + Math.random() * 2, speed: 8 + Math.random() * 7, phase: Math.random() * Math.PI * 2 })
      }
      ctx.clearRect(0, 0, width, height)
      // Resolve the token each frame so an open composer follows theme changes.
      ctx.fillStyle = getComputedStyle(canvas).color
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!
        p.life += dt
        p.y -= p.speed * dt * (1 + gain * 3)
        if (p.life > p.span || p.y < 0) { particles.splice(i, 1); continue }
        ctx.globalAlpha = Math.sin(p.life / p.span * Math.PI) * 0.5 * Math.max(0, Math.min(1, (height - p.y) / 12, p.y / 12))
        ctx.beginPath()
        ctx.arc(p.x + Math.sin(now / 1100 + p.phase) * 5, p.y, 0.9 + gain * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      frame = requestAnimationFrame(tick)
    }
    const visibility = () => {
      cancelAnimationFrame(frame)
      if (!document.hidden) { last = performance.now(); frame = requestAnimationFrame(tick) }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    document.addEventListener('visibilitychange', visibility)
    visibility()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      ctx.clearRect(0, 0, width, height)
    }
  }, [active, energy, reducedMotion])

  return <canvas ref={canvasRef} className="prompt-sparks" aria-hidden="true" />
}
