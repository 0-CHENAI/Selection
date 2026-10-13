import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { PANEL_SPRING } from '@craft-agent/ui'
import { PANEL_EDGE_INSET, PANEL_GAP, PANEL_MIN_WIDTH } from './panel-constants'
import { OfficePreviewResizeHandle } from './OfficePreviewResizeHandle'

const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// The parent is an inline-size query container. Both layers use its width so
// opening/closing only clips the document; it does not reflow the iframe.
const panelWidth = `min(max(50cqw, calc(100cqw - ${PANEL_MIN_WIDTH}px)), max(320px, var(--office-panel-preferred-width, 45cqw)))`

/** Keep cached iframe nodes mounted, including the outgoing page until its fade finishes. */
export function OfficePreviewPanel({ open, children, onPresenceChange }: { open: boolean; children: ReactNode; onPresenceChange: (present: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => true)
  const [present, setPresent] = useState(open)
  const lastVisible = useRef(children)
  const visible = useRef(open)
  useLayoutEffect(() => {
    visible.current = open
    if (open) { lastVisible.current = children; setPresent(true); onPresenceChange(true) }
    else if (root.current?.contains(document.activeElement)) {
      document.querySelector<HTMLButtonElement>('[data-office-collaboration]')?.focus()
    }
  }, [open, children, onPresenceChange])
  // Animate only the open/close fraction. Container units follow native window
  // resizing in CSS without React updates or a spring chasing every new width.
  return <motion.div ref={root} data-office-panel={open ? 'open' : present ? 'closing' : 'closed'}
    className="relative z-panel h-full min-h-0 shrink-0 overflow-x-clip overflow-y-visible"
    aria-hidden={!open || undefined}
    style={{ width: `calc(var(--office-panel-open) * ${panelWidth})`, pointerEvents: open ? undefined : 'none' }}
    initial={reduceMotion ? false : { '--office-panel-open': 0, opacity: 0 }}
    animate={{ '--office-panel-open': open ? 1 : 0, opacity: open ? 1 : 0 }}
    transition={reduceMotion ? { duration: 0 } : PANEL_SPRING}
    onAnimationComplete={() => { if (!visible.current) { lastVisible.current = null; setPresent(false); onPresenceChange(false) } }}>
    {open && <OfficePreviewResizeHandle />}
    <div className="h-full min-h-0" style={{ width: panelWidth, paddingLeft: PANEL_GAP, paddingRight: PANEL_EDGE_INSET, paddingBottom: PANEL_EDGE_INSET }}>
      {open || !present ? children : lastVisible.current}
    </div>
  </motion.div>
}
