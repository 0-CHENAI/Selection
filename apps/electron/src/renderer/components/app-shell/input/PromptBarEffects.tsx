import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { HelpCircleIcon } from '@hugeicons/core-free-icons'
import { Item as MenuItem } from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { type ThinkingLevel, type ThinkingLevelDefinition, getThinkingLevelNameKey } from '@craft-agent/shared/agent/thinking-levels'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import { EffortParticles } from './EffortParticles'
import './PromptBarEffects.css'

// Slider geometry and motion adapted from https://reactbits.dev/r/PromptBar-TS-TW.json.
const EFFORT_EDGE = 11
// Slightly larger than the 22px track so the knob reads as floating above it.
const EFFORT_THUMB = 26

function effortField(level: ThinkingLevel | undefined): 'max' | 'prelude' | undefined {
  if (level === 'max') return 'max'
  if (level === 'high' || level === 'xhigh') return 'prelude'
  return undefined
}

export function PromptThinkingSettings({
  value, levels, workMode, disabled, onChange, unavailable, binary, headingAction, inMenu = true,
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
  /** Sits at the right of the effort heading. Used for the Fast switch; effort stays independent. */
  headingAction?: React.ReactNode
  /** Desktop menu wraps the track in a menu item. The compact drawer does not. */
  inMenu?: boolean
}) {
  const { t } = useTranslation()
  const dragFraction = React.useRef<number | null>(null)
  const [preview, setPreview] = React.useState<number | null>(null)
  if (unavailable) {
    const note = unavailable === 'always-on' ? 'thinking.alwaysOn' : 'thinking.notSupported'
    return (
      <div className="prompt-effort-settings" data-thinking-mode={unavailable} data-work-mode={workMode}>
        <div className="prompt-effort-heading">
          <span className="text-muted-foreground" title={t('thinking.effortHelp')}>{t('thinking.effort')}</span>
          <span className="prompt-effort-value font-medium">{t(unavailable === 'always-on' ? 'thinking.alwaysOnShort' : 'thinking.notSupported')}</span>
          {headingAction}
        </div>
        <p className="prompt-effort-note text-muted-foreground">{t(note)}</p>
      </div>
    )
  }
  const span = Math.max(1, levels.length - 1)
  const resting = Math.max(0, levels.findIndex(level => level.id === value))
  const fraction = preview === null ? resting / span : preview
  const nearest = preview === null ? resting : Math.max(0, Math.min(levels.length - 1, Math.round(preview * span)))
  const visualLevel = levels[nearest]?.id ?? value
  const atMax = visualLevel === 'max'
  const valueKey = binary ? (visualLevel === 'off' ? 'thinking.off' : 'thinking.on') : getThinkingLevelNameKey(visualLevel)
  if (levels.length === 0) return null
  const inactive = disabled || levels.length === 1
  const field = inactive ? undefined : effortField(visualLevel)
  const stepAt = (i: number) => `calc(${EFFORT_EDGE}px + (100% - ${EFFORT_EDGE * 2}px) * ${i / span})`
  const visualIndex = fraction * span
  const setIndex = (next: number) => {
    if (inactive) return
    const level = levels[Math.max(0, Math.min(levels.length - 1, next))]!
    if (level.id !== value) onChange(level.id)
  }
  const pointerFraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const raw = (event.clientX - rect.left - EFFORT_EDGE) / Math.max(1, rect.width - EFFORT_EDGE * 2)
    return Math.max(0, Math.min(1, raw))
  }
  const followPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (inactive) return
    const next = pointerFraction(event)
    dragFraction.current = next
    setPreview(next)
  }
  const finishDrag = (commit: boolean) => {
    const held = dragFraction.current
    dragFraction.current = null
    setPreview(null)
    if (commit && held !== null) setIndex(Math.round(held * span))
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (inactive || dragFraction.current !== null) return
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    event.stopPropagation()
    setIndex(step ? nearest + step : event.key === 'Home' ? 0 : levels.length - 1)
  }
  const help = inMenu && !headingAction ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <MenuItem asChild onSelect={event => event.preventDefault()}>
          <button type="button" className="prompt-effort-help" aria-label={t('thinking.effortHelp')}>
            <HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </MenuItem>
      </TooltipTrigger>
      <TooltipContent>{t('thinking.effortHelp')}</TooltipContent>
    </Tooltip>
  ) : null
  const track = (
    <div
      className="prompt-effort-track"
      role="slider"
      tabIndex={inactive ? -1 : 0}
      aria-label={t('thinking.effort')}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={levels.length - 1}
      aria-valuenow={nearest}
      aria-valuetext={t(valueKey)}
      aria-disabled={inactive}
      data-dragging={preview !== null || undefined}
      style={{
        '--prompt-effort-x': stepAt(visualIndex),
        '--prompt-effort-thumb': `${EFFORT_THUMB}px`,
        '--prompt-effort-fill': fraction >= 0.999 ? '100%' : `calc(${stepAt(visualIndex)} + ${EFFORT_THUMB / 2}px)`,
      } as React.CSSProperties}
      onPointerDown={event => {
        if (event.button !== 0 || inactive) return
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus({ preventScroll: true })
        followPointer(event)
      }}
      onPointerMove={event => { if (dragFraction.current !== null && event.buttons & 1) followPointer(event) }}
      onPointerUp={() => finishDrag(true)}
      onPointerCancel={() => finishDrag(false)}
      onLostPointerCapture={event => { if (event.buttons === 0) finishDrag(true) }}
      onKeyDown={onKeyDown}
    >
      <span className="prompt-effort-fill" aria-hidden="true" />
      {field && <EffortParticles mode={field} />}
      {levels.map((level, i) => (
        <i key={level.id} className={i === nearest ? 'prompt-effort-dot is-current' : 'prompt-effort-dot'} style={{ left: stepAt(i) }} aria-hidden="true" />
      ))}
      <span className="prompt-effort-thumb" aria-hidden="true" />
    </div>
  )

  return (
    <div className="prompt-effort-settings" data-max={atMax || undefined} data-field={field} data-work-mode={workMode}>
      <div className="prompt-effort-heading">
        <span className="text-muted-foreground" title={t('thinking.effortHelp')}>{t('thinking.effort')}</span>
        <span className={atMax ? 'prompt-effort-value is-max font-medium' : 'prompt-effort-value font-medium'}>{t(valueKey)}</span>
        {headingAction ?? help}
      </div>
      <div className="prompt-effort-endpoints text-muted-foreground">
        <span>{t(binary ? 'thinking.off' : 'thinking.faster')}</span>
        <span>{t(binary ? 'thinking.on' : 'thinking.smarter')}</span>
      </div>
      {inMenu ? (
        <MenuItem asChild disabled={inactive} onSelect={event => event.preventDefault()}>
          {track}
        </MenuItem>
      ) : track}
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
