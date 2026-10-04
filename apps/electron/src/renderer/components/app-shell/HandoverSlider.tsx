import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const [hint, setHint] = useState(0)
  const thumb = useRef<HTMLSpanElement>(null)
  const trail = useRef<HTMLSpanElement>(null)
  const gesture = useRef<{ x: number; grabbed: boolean; moved: boolean } | null>(null)
  const progress = Math.abs(value - start) / 100
  const reset = () => { gesture.current = null; setDragging(false); setValue(start) }
  useEffect(() => {
    if (!hint) return
    // Demonstrate the gesture visually without changing the native value or mode.
    const stops = [{ offset: 0, progress: 0 }, { offset: 0.5, progress: 0.85 }, { offset: 0.65, progress: 0.85 }, { offset: 1, progress: 0 }]
    const frames = stops.map(stop => ({ ...stop, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }))
    const animations = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? [] : [
      thumb.current?.animate(frames.map(({ offset, progress, easing }) => ({ offset, easing, transform: `translateX(calc(3.5rem * ${(start + (target - start) * progress) / 100}))` })), { duration: 1100 }),
      trail.current?.animate(frames.map(({ offset, progress, easing }) => ({ offset, easing, transform: `scaleX(${progress})` })), { duration: 1100 }),
    ]
    const timer = setTimeout(() => setHint(0), 1200)
    return () => { animations.forEach(animation => animation?.cancel()); clearTimeout(timer) }
  }, [hint, start, target])
  const finish = (position: number) => {
    reset()
    if (!disabled && position === target) onActivate()
  }
  return <div data-handover-control data-mode={mode} data-hint={hint > 0 ? '' : undefined} className={`titlebar-no-drag group relative h-7 w-[7.25rem] shrink-0 select-none rounded-full bg-foreground/5 transition-colors duration-200 motion-reduce:transition-none ${disabled ? 'opacity-50' : 'hover:bg-foreground/[0.07]'}`} dir="ltr">
    <input type="range" min={0} max={100} step={1} value={value} disabled={disabled}
      aria-label={t('handover.slideTo', { mode: targetMode })}
      aria-valuetext={`${mode} → ${targetMode} · ${mode === 'NORM' ? value : 100 - value}%`}
      className="absolute inset-x-0.5 inset-y-0 z-10 m-0 h-full w-[calc(100%-0.25rem)] touch-none cursor-grab appearance-none bg-transparent opacity-0 active:cursor-grabbing disabled:cursor-default [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-14 [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-14"
      onChange={event => {
        if (gesture.current && (!gesture.current.grabbed || !gesture.current.moved)) event.currentTarget.value = String(start)
        else setValue(event.currentTarget.valueAsNumber)
      }}
      onPointerDown={event => {
        if (event.button !== 0) return
        setHint(0)
        const rect = event.currentTarget.getBoundingClientRect()
        const grabbed = mode === 'NORM' ? event.clientX <= rect.x + rect.width / 2 : event.clientX >= rect.x + rect.width / 2
        gesture.current = { x: event.clientX, grabbed, moved: false }
        if (!grabbed) event.preventDefault()
        setDragging(grabbed)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (gesture.current && Math.abs(event.clientX - gesture.current.x) >= 4) gesture.current.moved = true
      }}
      onPointerUp={event => {
        const current = gesture.current, position = event.currentTarget.valueAsNumber
        reset()
        if (disabled || !current) return
        if (current.grabbed && current.moved) { if (position === target) onActivate() }
        else setHint(count => count + 1)
      }}
      onPointerCancel={reset} onLostPointerCapture={reset} onBlur={() => { reset(); setHint(0) }}
      onKeyDown={event => {
        setHint(0)
        if (event.key === 'Escape') { event.preventDefault(); reset() }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finish(target) }
      }}
      onKeyUp={event => {
        if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key) && event.currentTarget.valueAsNumber === target) finish(target)
      }} />
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full ring-accent/60 group-has-[:focus-visible]:ring-2" />
    <span ref={trail} data-handover-trail aria-hidden="true" className={`pointer-events-none absolute inset-x-0.5 top-0.5 h-6 rounded-full bg-accent/10 ${dragging ? 'transition-none' : 'transition-transform duration-200 ease-out'} motion-reduce:transition-none`}
      style={{ transform: `scaleX(${progress})`, transformOrigin: mode === 'NORM' ? 'left' : 'right' }} />
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0.5 top-0.5 h-6">
      <span ref={thumb} data-handover-thumb className={`relative block h-6 w-14 ${dragging ? 'transition-none' : 'transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]'} motion-reduce:transition-none`}
        style={{ transform: `translateX(calc(3.5rem * ${value / 100}))` }}>
        <span data-handover-grip className={`absolute inset-0 rounded-full shadow-xs transition-[scale,background-color] duration-150 motion-reduce:transition-none motion-reduce:scale-100 ${dragging || hint ? 'scale-105' : 'scale-100'} ${dragging || hint || value === target ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-background in-[.dark]:bg-foreground-10'}`} />
      </span>
    </div>
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0.5 inset-y-0 grid grid-cols-2 items-center text-center text-[10px] font-medium">
      {(['NORM', 'PRO'] as const).map(labelMode => <span key={labelMode} className={`relative ${hint && labelMode === targetMode ? 'text-accent' : labelMode === mode || value === target ? 'text-foreground/85' : 'text-foreground/65'}`}>
        <span data-handover-mode={labelMode === mode ? '' : undefined} className={`tracking-[0.04em] transition-opacity duration-150 motion-reduce:transition-none ${labelMode !== mode || dragging || hint || disabled ? '' : 'group-hover:opacity-0 group-has-[:focus-visible]:opacity-0'}`}>{labelMode}</span>
        {labelMode === mode && <span data-handover-label className={`absolute inset-0 grid place-items-center whitespace-nowrap opacity-0 transition-opacity duration-150 motion-reduce:transition-none ${dragging || hint || disabled ? '' : 'group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}>{t('handover.slide')}</span>}
      </span>)}
    </div>
    <span role="status" className="sr-only">{hint > 0 ? t('handover.slideTo', { mode: targetMode }) : ''}</span>
  </div>
}
