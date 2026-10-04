import { EntityListBadge } from '@/components/ui/entity-list-badge'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'

export function SessionModeBadge({ mode }: { mode?: WorkMode }) {
  if (mode !== 'PRO') return null
  return <EntityListBadge colorClass="border border-[var(--pro-accent)] text-[var(--pro-accent)]" className="session-mode-badge tracking-wide">PRO</EntityListBadge>
}
