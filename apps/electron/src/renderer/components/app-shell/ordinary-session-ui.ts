type SidebarLinkLike = {
  id: string
  items?: unknown
  expandable?: boolean
  expanded?: boolean
  onToggle?: unknown
  sortable?: unknown
}

type SessionGroupingMode = 'date' | 'status' | 'unread' | 'project'

export function normalizeSessionGroupingMode(mode: SessionGroupingMode): SessionGroupingMode {
  return mode === 'status' ? 'date' : mode
}

const REMOVED_ROOT_LINKS = new Set(['nav:labels'])

/**
 * Produces the issue #180/#181 primary navigation without mutating the link
 * definitions. Keeping this as a pure transform makes the ordering and removal
 * rules independently testable from the large AppShell component.
 */
export function prepareOrdinarySessionSidebarLinks<T extends SidebarLinkLike>(links: T[]): T[] {
  const byId = new Map(links.map(link => [link.id, link]))
  const ordinary = byId.get('nav:allSessions')
  const projects = byId.get('nav:projects')
  const sources = byId.get('nav:sources')
  const separator = byId.get('separator:chats-sources')

  const ordered: T[] = []
  if (ordinary) {
    ordered.push({
      ...ordinary,
      items: undefined,
      expandable: false,
      expanded: undefined,
      onToggle: undefined,
      sortable: undefined,
    })
  }
  if (projects) ordered.push(projects)
  if (separator) ordered.push(separator)
  if (sources) ordered.push(sources)

  const promoted = new Set([
    'nav:allSessions',
    'nav:projects',
    'separator:chats-sources',
    'nav:sources',
  ])
  for (const link of links) {
    if (!promoted.has(link.id) && !REMOVED_ROOT_LINKS.has(link.id)) ordered.push(link)
  }

  return ordered
}

export type PersistedSessionViewFilters = Record<string, {
  statuses?: Record<string, unknown> | unknown[]
  labels?: Record<string, unknown> | unknown[]
  projects?: Record<string, 'include' | 'exclude'>
  groupingMode?: string
}>

/** Drop obsolete persisted filters while retaining project scope and grouping. */
export function sanitizeRemovedSessionFilters<T extends PersistedSessionViewFilters>(saved: T): T {
  const sanitized = Object.fromEntries(Object.entries(saved).map(([key, entry]) => [
    key,
    {
      ...entry,
      statuses: {},
      labels: {},
      groupingMode: entry.groupingMode === 'status' ? 'date' : entry.groupingMode,
    },
  ]))
  return sanitized as T
}
