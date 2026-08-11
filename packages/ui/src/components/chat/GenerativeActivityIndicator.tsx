/**
 * Compact generative activity indicator for "thinking / preparing response".
 * Uses generative-loaders InlineLoader — not for full markdown response bodies.
 *
 * Accessibility: decorative by default (aria-hidden). Adjacent visible text
 * (e.g. "Thinking…") should carry the status; pass `label` only when standalone.
 */

import { InlineLoader } from 'generative-loaders'
import { cn } from '../../lib/utils'

export type GenerativeActivityVariant = 'dot-pulse' | 'orbit' | 'signal' | 'spark'

export interface GenerativeActivityIndicatorProps {
  className?: string
  /** Loader size in px */
  size?: number
  variant?: GenerativeActivityVariant
  /** When set, exposes an accessible name and is not aria-hidden */
  label?: string
}

export function GenerativeActivityIndicator({
  className,
  size = 12,
  variant = 'dot-pulse',
  label,
}: GenerativeActivityIndicatorProps) {
  return (
    <span
      className={cn('inline-flex items-center justify-center shrink-0 text-current leading-none', className)}
      aria-hidden={label ? undefined : true}
      role={label ? 'status' : undefined}
      aria-label={label}
    >
      <InlineLoader
        variant={variant}
        size={size}
        color="currentColor"
        speed={1}
        // Library also accepts label; avoid double announcement when parent provides text
        {...(label ? { label } : {})}
      />
    </span>
  )
}
