import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { deriveOrchestrationDisplayState } from '@/lib/swarm-session'

interface OrchestrationStatusBadgeProps {
  status?: string
  blocker?: string
  onOpenDetails?: () => void
  compact?: boolean
}

export function OrchestrationStatusBadge({
  status,
  blocker,
  onOpenDetails,
  compact = false,
}: OrchestrationStatusBadgeProps) {
  const { t } = useTranslation()
  const displayState = deriveOrchestrationDisplayState(status)
  if (!displayState) return null

  const label = displayState === 'running'
    ? t('swarm.statusRunning')
    : displayState === 'completed'
      ? t('swarm.statusCompleted')
      : t('swarm.statusNeedToCheck')
  const title = blocker || label

  if (displayState === 'running' || displayState === 'completed') {
    const dot = (
      <span
        role="status"
        aria-label={label}
        title={title}
        className={cn(
          'inline-block size-2 shrink-0 rounded-full',
          displayState === 'running' ? 'bg-accent animate-pulse' : 'bg-success',
        )}
      />
    )
    return onOpenDetails ? (
      <button
        type="button"
        aria-label={label}
        title={title}
        className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onOpenDetails}
      >
        {dot}
      </button>
    ) : dot
  }

  const className = cn(
    'shrink-0 whitespace-nowrap text-amber-600 dark:text-amber-300',
    compact ? 'text-[10px]' : 'text-[11px] font-medium',
    onOpenDetails && 'cursor-pointer hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm',
  )

  return onOpenDetails ? (
    <button type="button" className={className} title={title} onClick={onOpenDetails}>
      {label}
    </button>
  ) : (
    <span role="status" className={className} title={title}>{label}</span>
  )
}
