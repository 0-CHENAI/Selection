import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import type { SessionMeta } from '@/atoms/sessions'
import { SessionItem } from './SessionItem'

/** Reuse chat rows so execution children retain status, unread and menu interactions. */
export function ExecutionChildren({ children, selectedSessionId, onSelect, label }: {
  children: SessionMeta[]
  label?: string
  selectedSessionId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const controlsId = useId()
  const containsSelected = children.some(child => child.id === selectedSessionId)
  const [open, setOpen] = useState(containsSelected || children.some(child => child.isProcessing || child.hasUnread))
  const reducedMotion = useReducedMotion()
  useEffect(() => { if (containsSelected) setOpen(true) }, [containsSelected])
  if (children.length === 0) return null
  return (
    <div className="ml-5 border-l border-border/60" data-execution-children>
      <button type="button" aria-expanded={open} aria-controls={controlsId} onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronRight className={`size-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
        {label ?? t('session.executionChildren', { count: children.length })}
        {children.some(child => child.hasUnread) && <span className="ml-auto size-1.5 rounded-full bg-accent" aria-label={t('session.unreadGroup', { count: children.filter(child => child.hasUnread).length })} />}
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div id={controlsId} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.16 }} className="overflow-hidden">
          {children.map((child, index) => <SessionItem key={child.id} item={child} index={index}
            itemProps={{ role: 'option', tabIndex: 0, 'aria-selected': child.id === selectedSessionId,
              onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(child.id) } } }}
            isSelected={child.id === selectedSessionId} isFirstInGroup={index === 0} isInMultiSelect={false}
            onSelect={() => onSelect(child.id)} />)}
        </motion.div>}
      </AnimatePresence>
    </div>
  )
}
