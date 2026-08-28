import type { FilterMode } from './inherited-filter-params'

/** Apply the filter bar's include/exclude semantics to a session list. */
export function filterSessionsByProject<T extends { projectId?: string }>(
  sessions: T[],
  projectFilter: Map<string, FilterMode>
): T[] {
  if (projectFilter.size === 0) return sessions

  const includes = new Set<string>()
  const excludes = new Set<string>()

  for (const [id, mode] of projectFilter) {
    if (mode === 'include') includes.add(id)
    else excludes.add(id)
  }

  return sessions.filter(({ projectId }) => {
    if (includes.size > 0 && (projectId === undefined || !includes.has(projectId))) {
      return false
    }
    return projectId === undefined || !excludes.has(projectId)
  })
}
