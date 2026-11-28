/**
 * Info_Section
 *
 * Section container with title, optional description, and content card.
 * Matches SettingsSection styling pattern.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Info_SectionProps {
  /** Section title */
  title: string
  /** Optional description below title */
  description?: string
  /** Optional right-aligned header actions */
  actions?: React.ReactNode
  /** Section content */
  children: React.ReactNode
  className?: string
}

export function Info_Section({
  title,
  description,
  actions,
  children,
  className,
}: Info_SectionProps) {
  return (
    <section className={cn('min-w-0 space-y-3 pt-2', className)}>
      <div className="flex min-w-0 items-start justify-between gap-2 pl-1">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="text-base font-semibold break-words">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-muted-foreground break-words">{description}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="min-w-0 bg-background shadow-minimal rounded-[8px] overflow-hidden">
        {children}
      </div>
    </section>
  )
}
