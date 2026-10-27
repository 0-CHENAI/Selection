import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PanelsTopLeft, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { useOptionalAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { shouldShowHeaderTooltipOnFocus } from '@/components/ui/header-icon-tooltip'
import { officeButtonGenerating, officeCollaborationLiveProgress, officeProgressAttribute } from './office-collaboration-progress'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia(reducedMotionQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const getReducedMotion = () => window.matchMedia(reducedMotionQuery).matches

export function OfficeCollaborationButton({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation()
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => true)
  const collaboration = useOptionalAppShellContext()?.officeCollaboration
  const session = useSession(sessionId || 'office-collaboration-none')
  const owned = sessionId && session?.id === sessionId ? session : null
  const generating = officeButtonGenerating(owned)
  const live = generating ? officeCollaborationLiveProgress(owned?.pptProgress) : null
  const name = t('chat.officePreview.collaborate')
  const label = live
    ? t('chat.officePreview.generatingLabel', { name, current: live.current, total: live.total })
    : name
  const pageTooltip = live
    ? live.title
      ? t('chat.officePreview.generatingTooltipTitle', { current: live.current, total: live.total, title: live.title })
      : t('chat.officePreview.generatingTooltip', { current: live.current, total: live.total })
    : undefined
  const tooltip = pageTooltip ?? t(collaboration?.active ? 'chat.officePreview.closeLabel' : 'chat.officePreview.collaborateHint')
  const button = useRef<HTMLButtonElement>(null)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const tooltipDismissed = useRef(false)
  const tooltipScope = `${sessionId}:${collaboration?.active}:${collaboration?.choosing}`
  const previousTooltipScope = useRef(tooltipScope)
  useLayoutEffect(() => {
    if (previousTooltipScope.current !== tooltipScope) tooltipDismissed.current = true
    previousTooltipScope.current = tooltipScope
    setTooltipOpen(false)
  }, [tooltipScope])
  const dismissTooltip = () => { tooltipDismissed.current = true; setTooltipOpen(false) }
  const visible = !!collaboration && collaboration.sessionId === sessionId && (collaboration.available || collaboration.active || generating)
  return <AnimatePresence>
    {visible && collaboration && <motion.div key="office-collaboration"
      initial={reducedMotion ? false : { opacity: 0, y: 5, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.96 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}>
      <Tooltip open={tooltipOpen && visible} onOpenChange={open => {
        if (!open) setTooltipOpen(false)
        else if (!tooltipDismissed.current && button.current
          && (button.current.matches(':hover') || shouldShowHeaderTooltipOnFocus(button.current))) setTooltipOpen(true)
      }}>
        <TooltipTrigger asChild>
          <button ref={button} type="button" onClick={() => { dismissTooltip(); collaboration.onToggle() }} data-office-collaboration
            onPointerDown={dismissTooltip}
            onPointerEnter={() => { tooltipDismissed.current = false }}
            onPointerLeave={() => setTooltipOpen(false)}
            onBlur={() => { tooltipDismissed.current = false; setTooltipOpen(false) }}
            aria-label={label} aria-pressed={collaboration.active}
            aria-expanded={collaboration.active || collaboration.choosing}
            data-generating={generating ? 'true' : undefined}
            data-ppt-tooltip={pageTooltip}
            style={!generating && collaboration.active ? { '--shadow-color': 'var(--accent-rgb)' } as CSSProperties : undefined}
            className={cn(
              'relative h-[30px] overflow-hidden rounded-[8px] px-3 text-xs font-medium flex items-center gap-1.5 shrink-0',
              'outline-none select-none transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
              generating
                ? 'bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)] text-accent shadow-minimal'
                : collaboration.active
                  ? 'bg-accent/10 text-accent shadow-tinted'
                  : 'bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)] text-foreground/80 shadow-minimal hover:bg-foreground/5',
              !generating && collaboration.choosing && 'bg-foreground/5',
            )}>
            {live && <span aria-hidden="true" data-testid="office-collaboration-progress" data-progress={officeProgressAttribute(live.fraction)} className="pointer-events-none absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--accent)_18%,var(--background))]" style={{ width: `${live.fraction * 100}%` }} />}
            {!generating && (collaboration.active ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : <PanelsTopLeft aria-hidden="true" className="size-3.5 shrink-0" />)}
            <span className="relative whitespace-nowrap tabular-nums">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </motion.div>}
  </AnimatePresence>
}
