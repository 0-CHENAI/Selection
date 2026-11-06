import { useId, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import { ProIdentityDialog } from './ProIdentityDialog'
import { ProIdentityGlyph } from './ProIdentityGlyph'
import { addSessionModeBadgeReveal } from './pro-identity-motion'
import './pro-identity-dialog.css'

export function SessionModeBadge({ mode }: { mode?: WorkMode }) {
  const active = mode === 'PRO'
  const [present, setPresent] = useState(active)
  const skipEnter = useRef(active)
  useLayoutEffect(() => {
    if (active) setPresent(true)
  }, [active])
  if (!present) return null
  return (
    <ProModeBadge
      active={active}
      skipEnter={skipEnter.current}
      onExited={() => {
        skipEnter.current = false
        setPresent(false)
      }}
    />
  )
}

function ProModeBadge({ active, skipEnter, onExited }: {
  active: boolean
  skipEnter: boolean
  onExited: () => void
}) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const animation = useRef<gsap.core.Timeline | null>(null)
  const activeRef = useRef(active)
  const onExitedRef = useRef(onExited)
  const skipEnterRef = useRef(skipEnter)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const restoringFocus = useRef(false)
  const clicks = useRef({ count: 0, at: 0 })
  const glassId = useId()
  activeRef.current = active
  onExitedRef.current = onExited

  useLayoutEffect(() => {
    const media = gsap.matchMedia()
    media.add({ all: 'all', reduceMotion: '(prefers-reduced-motion: reduce)' }, context => {
      const reduced = context.conditions?.reduceMotion
      const timeline = gsap.timeline({
        paused: true,
        onReverseComplete: () => {
          if (!activeRef.current) onExitedRef.current()
        },
        onComplete: () => { skipEnterRef.current = true },
      })
      addSessionModeBadgeReveal(timeline, reduced)
      animation.current = timeline
      if (activeRef.current && skipEnterRef.current) timeline.progress(1)
      else if (!activeRef.current) {
        timeline.progress(0)
        onExitedRef.current()
      }
    }, root)
    return () => {
      media.revert()
      animation.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const timeline = animation.current
    if (!timeline) return
    if (active) {
      // progress(1) already applied for an already-PRO session; play() would restart it.
      if (timeline.progress() === 1 && !timeline.reversed()) return
      timeline.play()
    } else timeline.reverse()
  }, [active])

  const reveal = () => {
    const at = performance.now()
    const count = at - clicks.current.at <= 1000 ? clicks.current.count + 1 : 1
    clicks.current = { count, at }
    if (count === 3) {
      clicks.current = { count: 0, at: 0 }
      setOpen(true)
    }
  }
  return (
    <div ref={root} className="ml-2 inline-flex h-5 shrink-0 items-center">
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild onFocus={event => { if (restoringFocus.current) event.preventDefault() }}>
          <button
            ref={trigger}
            type="button"
            onClick={reveal}
            onDoubleClick={event => event.preventDefault()}
            aria-label={t('session.currentProMode')}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="session-mode-badge inline-flex h-5 shrink-0 cursor-pointer touch-manipulation select-none items-center border-0 bg-transparent p-0 text-[var(--pro-accent)] outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-[var(--pro-accent)]"
          >
            <span className="sr-only">PRO</span>
            <ProIdentityGlyph id={glassId} />
          </button>
        </TooltipTrigger>
        {!open && <TooltipContent side="top">{t('session.currentProMode')}</TooltipContent>}
      </Tooltip>
      <ProIdentityDialog open={open} onOpenChange={setOpen} onRestoreFocus={() => {
        // Returning from the easter egg must not reopen the focus tooltip.
        restoringFocus.current = true
        trigger.current?.focus({ preventScroll: true })
        restoringFocus.current = false
      }} />
    </div>
  )
}
