import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { PANEL_SPRING } from '@craft-agent/ui'
import { PANEL_EDGE_INSET, PANEL_GAP } from './panel-constants'

const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Keep cached iframe nodes mounted, including the outgoing page until its fade finishes. */
export function OfficePreviewPanel({ open, children, onPresenceChange }: { open: boolean; children: ReactNode; onPresenceChange: (present: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => true)
  const [containerWidth, setContainerWidth] = useState(0)
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
  useLayoutEffect(() => {
    const parent = root.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  // Match the existing 45% split, allowing narrower windows to keep both regions visible.
  const width = Math.min(containerWidth / 2, Math.max(320, containerWidth * 0.45))
  return <motion.div ref={root} data-office-panel={open ? 'open' : present ? 'closing' : 'closed'}
    className="h-full min-h-0 shrink-0 overflow-hidden"
    aria-hidden={!open || undefined}
    style={{ pointerEvents: open ? undefined : 'none' }}
    initial={reduceMotion ? false : { width: 0, opacity: 0 }}
    animate={{ width: open ? width : 0, opacity: open ? 1 : 0 }}
    transition={reduceMotion ? { duration: 0 } : PANEL_SPRING}
    onAnimationComplete={() => { if (!visible.current) { lastVisible.current = null; setPresent(false); onPresenceChange(false) } }}>
    <div className="h-full min-h-0" style={{ width, paddingLeft: PANEL_GAP, paddingRight: PANEL_EDGE_INSET, paddingBottom: PANEL_EDGE_INSET }}>
      {open || !present ? children : lastVisible.current}
    </div>
  </motion.div>
}
