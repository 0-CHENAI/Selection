import * as React from "react"
import { useTranslation } from "react-i18next"
import { cn } from "../../lib/utils"
import LatticeLoader, { type LatticeStatus } from './LatticeLoader'

/**
 * Format duration in human-readable form
 * @param ms Duration in milliseconds
 * @returns "45s" for under a minute, "1:02" for 1+ minutes
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export interface SpinnerProps {
  /** Additional className */
  className?: string
  status?: LatticeStatus
}

/**
 * Compact LatticeLoader. Keeps existing em sizing and adjacent status text.
 *
 * Features:
 * - Uses the active theme's foreground, success and error colors
 * - Uses em sizing (scales with font-size)
 * - 3x3 orbit wave, dissolving into a check or cross
 * - CSS animation with no per-icon timer
 *
 * Usage:
 * ```tsx
 * // Inherits color and size from parent
 * <div className="text-muted-foreground text-sm">
 *   <Spinner />
 * </div>
 *
 * // Or override with className
 * <Spinner className="text-amber-500 text-lg" />
 * ```
 */
export function Spinner({ className, status = 'working' }: SpinnerProps) {
  const { t } = useTranslation()
  return (
    <LatticeLoader
      className={cn('lattice-loader--compact leading-none', className)}
      status={status}
      label={t('common.loading')}
      doneLabel={t('common.done')}
      errorLabel={t('common.failed')}
      color="currentColor"
      cellSize="0.28em"
      gap="0.08em"
      fontSize="1em"
      idleOpacity={0.16}
      showLabel={false}
      showTimer={false}
    />
  )
}

export interface LoadingIndicatorProps {
  /** Optional label to show next to spinner */
  label?: string
  /** Whether to animate the spinner */
  animated?: boolean
  /** Show elapsed time (pass start timestamp or true to auto-track) */
  showElapsed?: boolean | number
  /** Additional className for the container */
  className?: string
  /** Additional className for the spinner (e.g., "text-xs" to make it smaller) */
  spinnerClassName?: string
}

/**
 * LoadingIndicator - Spinner with optional label and elapsed time
 *
 * Inherits text color and size from parent element.
 *
 * Features:
 * - Animated 3x3 dot grid spinner (CSS-only)
 * - Optional label text
 * - Optional elapsed time display
 */
export function LoadingIndicator({
  label,
  animated = true,
  showElapsed = false,
  className,
  spinnerClassName,
}: LoadingIndicatorProps) {
  const [elapsed, setElapsed] = React.useState(0)
  const startTimeRef = React.useRef<number | null>(null)

  // Elapsed time tracking
  React.useEffect(() => {
    if (!showElapsed) return

    // Initialize start time
    if (typeof showElapsed === 'number') {
      startTimeRef.current = showElapsed
    } else if (!startTimeRef.current) {
      startTimeRef.current = Date.now()
    }

    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Date.now() - startTimeRef.current)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [showElapsed])

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* Spinner */}
      {animated ? (
        <Spinner className={spinnerClassName} />
      ) : (
        <span className="inline-flex items-center justify-center w-[1em] h-[1em]">●</span>
      )}

      {/* Label */}
      {label && (
        <span className="text-muted-foreground">
          {label}
        </span>
      )}

      {/* Elapsed time */}
      {showElapsed && elapsed >= 1000 && (
        <span className="text-muted-foreground/60 tabular-nums">
          ({formatDuration(elapsed)})
        </span>
      )}
    </span>
  )
}
