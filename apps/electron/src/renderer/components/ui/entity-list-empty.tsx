/**
 * EntityListEmptyScreen — Unified empty state for entity lists.
 *
 * Wraps the Empty primitives into a single configurable component
 * used by SessionList, SourcesListPanel, and SkillsListPanel.
 */

import * as React from 'react'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from './empty'

export interface EntityListEmptyScreenProps {
  icon: React.ReactNode
  title: string
  description: string
  /**
   * @deprecated External docs links removed. Prop kept so call sites still type-check; ignored.
   */
  docKey?: string
  /** Extra action buttons */
  children?: React.ReactNode
  className?: string
}

export function EntityListEmptyScreen({
  icon,
  title,
  description,
  children,
  className = 'flex-1',
}: EntityListEmptyScreenProps) {
  const hasActions = !!children

  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {icon}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {hasActions && (
        <EmptyContent>
          {children}
        </EmptyContent>
      )}
    </Empty>
  )
}
