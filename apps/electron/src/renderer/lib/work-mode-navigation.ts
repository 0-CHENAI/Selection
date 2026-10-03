import type { SessionMeta } from '@/atoms/sessions'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import { isOrdinarySessionVisible } from './swarm-session'

export function isWorkModeRoot(session: SessionMeta, mode: WorkMode): boolean {
  return isOrdinarySessionVisible(session) && !session.parentSessionId && !session.taskNodeId
    && session.orchestrationRole !== 'worker' && session.orchestrationRole !== 'reviewer'
    && (!(session.executionRootSessionId ?? session.orchestrationRootSessionId) || (session.executionRootSessionId ?? session.orchestrationRootSessionId) === session.id)
    && (session.workMode ?? 'NORM') === mode
}
export function executionChildrenByRoot(sessions: readonly SessionMeta[]): Map<string, SessionMeta[]> {
  const byId = new Map(sessions.map(session => [session.id, session]))
  const grouped = new Map<string, SessionMeta[]>()
  for (const session of sessions) {
    const rootId = session.executionRootSessionId ?? session.orchestrationRootSessionId ?? session.parentSessionId
    if (!rootId || rootId === session.id || !byId.has(rootId)) continue
    const children = grouped.get(rootId) ?? []
    children.push(session)
    grouped.set(rootId, children)
  }
  for (const children of grouped.values()) children.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  return grouped
}


export function sessionWorkModeView(session: SessionMeta | undefined, byId: ReadonlyMap<string, SessionMeta>): WorkMode | undefined {
  if (!session) return undefined
  const rootId = session.executionRootSessionId ?? session.orchestrationRootSessionId ?? session.parentSessionId
  return (rootId ? byId.get(rootId)?.workMode : undefined) ?? session.workMode
}

export function isUnownedExecution(session: SessionMeta, byId: ReadonlyMap<string, SessionMeta>): boolean {
  const rootId = session.executionRootSessionId ?? session.orchestrationRootSessionId ?? session.parentSessionId
  const root = rootId ? byId.get(rootId) : undefined
  return !!session.workModeNeedsReview && !isWorkModeRoot(session, session.workMode ?? 'NORM')
    && (!root || !isWorkModeRoot(root, root.workMode ?? 'NORM'))
}
