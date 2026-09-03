import type { FilterMode } from './inherited-filter-params'

/** A project include represents an active project child in the sidebar. */
export function hasIncludedProjectFilter(projectFilter: Map<string, FilterMode>): boolean {
  return Array.from(projectFilter.values()).some(mode => mode === 'include')
}

/** Resolve the sidebar project child represented by a single included project. */
export function getIncludedProjectName<T extends { config: { id: string; name: string } }>(
  projectFilter: Map<string, FilterMode>,
  projects: T[],
): string | undefined {
  const includedProjectIds = Array.from(projectFilter.entries())
    .filter(([, mode]) => mode === 'include')
    .map(([projectId]) => projectId)

  if (includedProjectIds.length !== 1) return undefined

  return projects.find(project => project.config.id === includedProjectIds[0])?.config.name
}

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
