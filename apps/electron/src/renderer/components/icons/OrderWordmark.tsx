import { cn } from '@/lib/utils'

interface OrderWordmarkProps {
  className?: string
}

/**
 * ORDER brand wordmark — Alumni Sans Pinstripe, no icon.
 * Stroke is applied via `.font-order` (the face has no bold cut).
 */
export function OrderWordmark({ className }: OrderWordmarkProps) {
  return (
    <span
      className={cn(
        'font-order font-normal leading-none tracking-[0.06em] text-foreground',
        className,
      )}
      aria-label="ORDER"
    >
      ORDER
    </span>
  )
}
