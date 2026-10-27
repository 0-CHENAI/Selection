import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { useOptionalAppShellContext, useSession } from '@/context/AppShellContext'
import { shouldShowHeaderTooltipOnFocus } from '@/components/ui/header-icon-tooltip'
import { officeButtonCopy, officeButtonGenerating, officeCollaborationLiveProgress } from './office-collaboration-progress'
import { OfficeCollaborationButtonFace } from './OfficeCollaborationButtonFace'

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
  const copy = officeButtonCopy(t, { active: !!collaboration?.active, live })
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
          <OfficeCollaborationButtonFace
            ref={button}
            label={copy.label}
            pressed={collaboration.active}
            expanded={collaboration.active || collaboration.choosing}
            generating={generating}
            choosing={collaboration.choosing}
            progress={live?.fraction}
            pageTooltip={copy.pageTooltip}
            onClick={() => { dismissTooltip(); collaboration.onToggle() }}
            onPointerDown={dismissTooltip}
            onPointerEnter={() => { tooltipDismissed.current = false }}
            onPointerLeave={() => setTooltipOpen(false)}
            onBlur={() => { tooltipDismissed.current = false; setTooltipOpen(false) }}
          />
        </TooltipTrigger>
        <TooltipContent side="top">{copy.tooltip}</TooltipContent>
      </Tooltip>
    </motion.div>}
  </AnimatePresence>
}
