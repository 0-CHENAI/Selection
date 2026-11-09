import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { panelPushTransition } from '@craft-agent/ui'
import { bindOfficeLeadingWidth, officePanelWidthCss } from '@/lib/office-panel-width'
import { PANEL_EDGE_INSET, PANEL_GAP } from './panel-constants'
import { OfficePreviewResizeHandle } from './OfficePreviewResizeHandle'

const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// The parent is an inline-size query container. Both layers use its width so
// opening/closing only clips the document; it does not reflow the iframe.
// The width is taken from the space after the sidebar and list, and it cannot
// push the conversation column under its minimum.
const panelWidth = officePanelWidthCss()

/** Measures the sidebar and list so the office panel can leave the chat its minimum. */
export function OfficeLayoutFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const layout = ref.current
    if (!layout) return
    return bindOfficeLeadingWidth(layout)
  }, [])
  return <div ref={ref} className="flex flex-1 min-h-0 @container/office-layout">{children}</div>
}

/** Keep cached iframe nodes mounted until the close animation finishes. */
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
  // Only the open fraction springs. Dragging writes --office-panel-preferred-width
  // directly, and container units follow window resizing without a spring.
  // The card is pinned to the right edge of the growing slot so it slides in
  // from the right while the fixed seam pushes the conversation aside.
  return <motion.div ref={root} data-office-panel={open ? 'open' : present ? 'closing' : 'closed'}
    className="relative z-panel flex h-full min-h-0 min-w-0 shrink-0 overflow-x-clip overflow-y-visible"
    aria-hidden={!open || undefined}
    style={{ width: `calc(var(--office-panel-open, 0) * ${panelWidth})`, pointerEvents: open ? undefined : 'none' }}
    initial={reduceMotion ? false : { '--office-panel-open': 0 }}
    animate={{ '--office-panel-open': open ? 1 : 0 }}
    transition={panelPushTransition(reduceMotion)}
    onAnimationComplete={() => { if (!visible.current) { lastVisible.current = null; setPresent(false); onPresenceChange(false) } }}>
    {open && <OfficePreviewResizeHandle />}
    <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden" style={{ marginLeft: PANEL_GAP }}>
      <div className="absolute inset-y-0 right-0" style={{ width: `calc(${panelWidth} - ${PANEL_GAP}px)`, paddingRight: PANEL_EDGE_INSET, paddingBottom: PANEL_EDGE_INSET }}>
        {open || !present ? children : lastVisible.current}
      </div>
    </div>
  </motion.div>
}
