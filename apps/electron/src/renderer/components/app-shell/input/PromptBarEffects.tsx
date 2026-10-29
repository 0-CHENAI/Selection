import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import { HelpCircleIcon } from '@hugeicons/core-free-icons'
import { Item as MenuItem } from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { Check } from 'lucide-react'
import { type ThinkingLevel, type ThinkingLevelDefinition, DEFAULT_THINKING_LEVEL, getThinkingLevelNameKey } from '@craft-agent/shared/agent/thinking-levels'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import './PromptBarEffects.css'

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
  const valueKey = binary ? (value === 'off' ? 'thinking.off' : 'thinking.on') : getThinkingLevelNameKey(value)
  if (levels.length === 0) return null
  const inactive = disabled || levels.length === 1
  const atMax = value === 'max'
  const choose = (level: ThinkingLevel) => {
    if (inactive || level === value) return
    onChange(level)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (inactive || inMenu) return
    const index = Math.max(0, levels.findIndex(level => level.id === value))
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1
      : event.key === 'Home' ? 0
      : event.key === 'End' ? levels.length - 1
      : -1
    if (next < 0) return
    event.preventDefault()
    choose(levels[Math.max(0, Math.min(levels.length - 1, next))]!.id)
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
  const options = (
    <div
      className="prompt-effort-options"
      role={inMenu ? undefined : 'radiogroup'}
      aria-label={inMenu ? undefined : t('thinking.effort')}
      aria-disabled={inactive || undefined}
      onKeyDown={onKeyDown}
    >
      {levels.map(level => {
        const selected = level.id === value
        const name = t(binary ? (level.id === 'off' ? 'thinking.off' : 'thinking.on') : level.nameKey)
        const button = (
          <button
            type="button"
            key={inMenu ? undefined : level.id}
            role={inMenu ? 'menuitemradio' : 'radio'}
            aria-checked={selected}
            data-testid={`effort-level-${level.id}`}
            disabled={inactive}
            className="prompt-effort-option"
            onClick={inMenu ? undefined : () => choose(level.id)}
          >
            <span className="prompt-effort-option-copy">
              <span className="prompt-effort-option-name">
                {name}
                {level.id === DEFAULT_THINKING_LEVEL && <span className="prompt-effort-default">{t('thinking.default')}</span>}
              </span>
              <span className="prompt-effort-option-desc">{t(level.descriptionKey)}</span>
              {level.id === 'max' && <span className="prompt-effort-max-note">{t('thinking.maxUsage')}</span>}
            </span>
            {selected && <Check className="prompt-effort-check" aria-hidden="true" />}
          </button>
        )
        if (!inMenu) return button
        return (
          <MenuItem key={level.id} asChild disabled={inactive} onSelect={event => { event.preventDefault(); choose(level.id) }}>
            {button}
          </MenuItem>
        )
      })}
    </div>
  )

  return (
    <div className="prompt-effort-settings" data-max={atMax || undefined} data-work-mode={workMode}>
      <div className="prompt-effort-heading">
        <span className="text-muted-foreground" title={t('thinking.effortHelp')}>{t('thinking.effort')}</span>
        <span className="prompt-effort-value font-medium">{t(valueKey)}</span>
        {headingAction ?? help}
      </div>
      {options}
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
