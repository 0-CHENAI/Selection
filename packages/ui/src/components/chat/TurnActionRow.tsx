import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Shared chrome for the row under a chat message.
 * Regenerate and retry both render here so placement, size, hover, and theme stay the same.
 * Icon size matches TurnCard SIZE_CONFIG.iconSize (`w-3 h-3`); retry reuses the RefreshCw
 * glyph already used by regenerate.
 */
export const TURN_ACTION_ICON_CLASS = 'w-3 h-3'

const TURN_ACTION_BUTTON_CLASS = cn(
  'turn-action-btn flex items-center gap-1.5 transition-colors select-none',
  'focus:outline-none focus-visible:underline',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

export function TurnActionButton({
  icon,
  children,
  className,
  active = false,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode
  /** Success state (copy confirmation) replaces the muted hover treatment. */
  active?: boolean
}) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        TURN_ACTION_BUTTON_CLASS,
        active ? 'text-success' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/** Retry control. Same button, icon, and label slot as regenerate. */
export function TurnRetryButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <TurnActionButton
      data-action="retry"
      onClick={onClick}
      disabled={disabled}
      icon={<RefreshCw className={TURN_ACTION_ICON_CLASS} />}
    >
      <span>{label}</span>
    </TurnActionButton>
  )
}

export function ResponseActionRow({
  children,
  compact = false,
  plan = false,
  visible = true,
  completed = true,
  className,
}: {
  children: React.ReactNode
  compact?: boolean
  /** Plan cards keep the bordered muted footer; ordinary replies stay flush. */
  plan?: boolean
  visible?: boolean
  completed?: boolean
  className?: string
}) {
  if (compact) {
    return (
      <div
        data-response-actions=""
        className={cn(
          'pl-2.5 pr-2 py-1.5 border-t border-border/30 flex items-center bg-muted/20',
          'gap-3 text-[13px]',
          className,
        )}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      data-response-actions=""
      aria-hidden={!visible}
      style={{ opacity: visible ? 1 : 0 }}
      className={cn(
        'h-10 shrink-0 overflow-x-auto whitespace-nowrap flex items-center justify-between gap-3 transition-opacity duration-[400ms] ease-in-out motion-reduce:transition-none',
        plan
          ? cn('pl-4 pr-2.5 border-t', completed ? 'border-border/30 bg-muted/20' : 'border-transparent')
          : 'px-2.5',
        'text-[13px]',
        className,
      )}
    >
      {children}
    </div>
  )
}
