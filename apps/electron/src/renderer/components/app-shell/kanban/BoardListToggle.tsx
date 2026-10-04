import { MessageSquare, Workflow } from 'lucide-react'
import { useId } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type BoardListValue = 'NORM' | 'PRO'

interface BoardListToggleProps {
  value: BoardListValue
  onChange: (value: BoardListValue) => void
  className?: string
}

/**
 * NORM / PRO root conversation navigation. Desktop layouts keep one persistent TopBar
 * instance so changing views only updates the selected state and main content.
 */
export function BoardListToggle({ value, onChange, className }: BoardListToggleProps) {
  const { t } = useTranslation()
  const groupId = useId()
  return (
    <LayoutGroup id={groupId}>
      <div
        aria-label={t('session.workMode')}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-0.5',
          className
        )}
      >
        <ToggleButton active={value === 'NORM'} icon={MessageSquare} label="NORM" onClick={() => onChange('NORM')} />
        <ToggleButton
          active={value === 'PRO'}
          icon={Workflow}
          label="PRO"
          onClick={() => onChange('PRO')}
        />
      </div>
    </LayoutGroup>
  )
}

function ToggleButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof MessageSquare
  label: string
  onClick: () => void
}) {
  const reduced = useReducedMotion()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active ? 'text-foreground' : 'text-foreground/50 hover:text-foreground/80'
      )}
    >
      {active && <motion.span
        data-work-mode-indicator
        className="pointer-events-none absolute inset-0 rounded-md bg-card shadow-xs"
        layoutId="work-mode-indicator"
        initial={false}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 36, mass: 0.8 }}
      />}
      <Icon className="relative h-3.5 w-3.5" strokeWidth={2} />
      <span className="relative">{label}</span>
    </button>
  )
}
