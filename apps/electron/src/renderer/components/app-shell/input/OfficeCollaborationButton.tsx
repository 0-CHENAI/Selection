import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PanelsTopLeft, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { shouldShowHeaderTooltipOnFocus } from '@/components/ui/header-icon-tooltip'

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
  const visible = !!collaboration && collaboration.sessionId === sessionId && (collaboration.available || collaboration.active)
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
            aria-label={t('chat.officePreview.collaborate')} aria-pressed={collaboration.active}
            aria-expanded={collaboration.active || collaboration.choosing}
            style={collaboration.active ? { '--shadow-color': 'var(--accent-rgb)' } as CSSProperties : undefined}
            className={cn(
              'h-[30px] rounded-[8px] px-3 text-xs font-medium flex items-center gap-1.5 shrink-0',
              'outline-none select-none transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
              collaboration.active ? 'bg-accent/10 text-accent shadow-tinted' : 'shadow-minimal text-foreground/80 hover:bg-foreground/5',
              !collaboration.active && 'bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)]',
              collaboration.choosing && 'bg-foreground/5',
            )}>
            {collaboration.active ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : <PanelsTopLeft aria-hidden="true" className="size-3.5 shrink-0" />}
            <span className="whitespace-nowrap">{t('chat.officePreview.collaborate')}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{t(collaboration.active ? 'chat.officePreview.closeLabel' : 'chat.officePreview.collaborateHint')}</TooltipContent>
      </Tooltip>
    </motion.div>}
  </AnimatePresence>
}
