import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'

/** Opens the existing handover review; the source conversation keeps its mode. */
export function HandoverSlider({ mode, disabled, onActivate }: {
  mode: WorkMode; disabled?: boolean; onActivate: () => void
}) {
  const { t } = useTranslation()
  const start = mode === 'NORM' ? 0 : 100
  const target = 100 - start
  const targetMode = mode === 'NORM' ? 'PRO' : 'NORM'
  const [value, setValue] = useState(start)
  const [dragging, setDragging] = useState(false)
  const reset = () => { setDragging(false); setValue(start) }
  const finish = (position: number) => {
    reset()
    if (!disabled && position === target) onActivate()
  }
  const Arrow = mode === 'NORM' ? ArrowRight : ArrowLeft
  return <div className="titlebar-no-drag flex shrink-0 select-none items-center gap-1.5" dir="ltr">
    <span className={`rounded-md border border-foreground/5 bg-foreground/5 px-2 py-1 text-[10px] font-medium ${mode === 'NORM' ? 'text-foreground/75' : 'text-muted-foreground'}`}
      title={mode === 'NORM' ? t('session.workModeFixed') : undefined}>NORM</span>
    <div className={`group relative h-7 w-32 rounded-md bg-foreground/5 ${disabled ? 'opacity-50' : ''}`}>
      <input type="range" min={0} max={100} step={1} value={value} disabled={disabled}
        aria-label={t('handover.slideTo', { mode: targetMode })}
        aria-valuetext={`${mode} → ${targetMode} · ${mode === 'NORM' ? value : 100 - value}%`}
        title={t('handover.slideTo', { mode: targetMode })}
        className="absolute inset-x-0.5 inset-y-0 z-10 m-0 h-full w-[calc(100%-0.25rem)] touch-none cursor-grab appearance-none bg-transparent opacity-0 active:cursor-grabbing disabled:cursor-default [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-20 [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-20"
        onChange={event => setValue(event.currentTarget.valueAsNumber)}
        onPointerDown={event => { setDragging(true); event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerUp={event => finish(event.currentTarget.valueAsNumber)}
        onPointerCancel={reset} onLostPointerCapture={reset} onBlur={reset}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); reset() }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finish(target) }
        }}
        onKeyUp={event => {
          if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key) && event.currentTarget.valueAsNumber === target) finish(target)
        }} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md ring-accent/60 group-has-[:focus-visible]:ring-2" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0.5 top-0.5 h-6">
        <span className={`flex h-6 w-20 items-center justify-center gap-1 rounded bg-background text-[11px] font-medium text-foreground shadow-minimal ${dragging ? '' : 'transition-transform duration-200 ease-out motion-reduce:transition-none'}`}
          style={{ transform: `translateX(calc((8rem - 5rem - 0.25rem) * ${value / 100}))` }}>
          {mode === 'PRO' && <Arrow className="size-3 shrink-0" />}{t('handover.slide')}{mode === 'NORM' && <Arrow className="size-3 shrink-0" />}
        </span>
      </div>
    </div>
    <span className={`rounded-md border border-foreground/5 bg-foreground/5 px-2 py-1 text-[10px] font-medium ${mode === 'PRO' ? 'text-foreground/75' : 'text-muted-foreground'}`}
      title={mode === 'PRO' ? t('session.workModeFixed') : undefined}>PRO</span>
  </div>
}
