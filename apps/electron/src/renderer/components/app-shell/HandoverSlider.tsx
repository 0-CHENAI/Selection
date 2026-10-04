import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft } from 'lucide-react'
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
  return <div className="titlebar-no-drag flex shrink-0 select-none items-center gap-2" dir="ltr">
    <span className={`inline-flex h-7 w-12 items-center justify-center rounded-lg text-[10px] font-medium tracking-[0.06em] ${mode === 'NORM' ? 'bg-foreground/[0.07] text-foreground/85' : 'bg-foreground/[0.04] text-foreground/65'}`}
      title={mode === 'NORM' ? t('session.workModeFixed') : undefined}>NORM</span>
    <div className={`group relative h-7 w-[5.5rem] rounded-lg bg-foreground/5 transition-colors duration-200 motion-reduce:transition-none ${disabled ? 'opacity-50' : 'hover:bg-foreground/[0.07]'}`}>
      <input type="range" min={0} max={100} step={1} value={value} disabled={disabled}
        aria-label={t('handover.slideTo', { mode: targetMode })}
        aria-valuetext={`${mode} → ${targetMode} · ${mode === 'NORM' ? value : 100 - value}%`}
        title={t('handover.slideTo', { mode: targetMode })}
        className="absolute inset-x-0.5 inset-y-0 z-10 m-0 h-full w-[calc(100%-0.25rem)] touch-none cursor-grab appearance-none bg-transparent opacity-0 active:cursor-grabbing disabled:cursor-default [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-14 [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-14"
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
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg ring-accent/60 group-has-[:focus-visible]:ring-2" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0.5 top-0.5 h-6">
        <span className={`relative grid h-6 w-14 place-items-center rounded-md bg-background text-[10px] font-medium text-foreground/85 shadow-xs in-[.dark]:bg-foreground/10 ${dragging ? '' : 'transition-transform'} duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none`}
          style={{ transform: `translateX(calc((5.5rem - 3.5rem - 0.25rem) * ${value / 100}))` }}>
          <ArrowRightLeft data-handover-icon className={`size-3.5 text-foreground/70 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${disabled ? '' : 'group-hover:scale-90 group-hover:opacity-0 group-has-[:focus-visible]:scale-90 group-has-[:focus-visible]:opacity-0'}`} strokeWidth={1.5} />
          <span data-handover-label className={`absolute inset-0 grid translate-y-0.5 place-items-center whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${disabled ? '' : 'group-hover:translate-y-0 group-hover:opacity-100 group-has-[:focus-visible]:translate-y-0 group-has-[:focus-visible]:opacity-100'}`}>{t('handover.slide')}</span>
        </span>
      </div>
    </div>
    <span className={`inline-flex h-7 w-12 items-center justify-center rounded-lg text-[10px] font-medium tracking-[0.06em] ${mode === 'PRO' ? 'bg-foreground/[0.07] text-foreground/85' : 'bg-foreground/[0.04] text-foreground/65'}`}
      title={mode === 'PRO' ? t('session.workModeFixed') : undefined}>PRO</span>
  </div>
}
