import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeSessionGroupingMode,
  prepareOrdinarySessionSidebarLinks,
  sanitizeRemovedSessionFilters,
  sanitizeSidebarProjectScope,
  type PersistedSessionViewFilters,
} from './ordinary-session-ui'

describe('ordinary session UI migration', () => {
  it('removes classification navigation and promotes projects above sources', () => {
    const links = prepareOrdinarySessionSidebarLinks([
      { id: 'nav:allSessions', expandable: true, items: [{ id: 'nav:state:todo' }] },
      { id: 'nav:labels' },
      { id: 'separator:chats-sources' },
      { id: 'nav:sources' },
      { id: 'nav:skills' },
      { id: 'nav:projects' },
    ])

    expect(links.map(link => link.id)).toEqual([
      'nav:allSessions',
      'nav:projects',
      'separator:chats-sources',
      'nav:sources',
      'nav:skills',
    ])
    expect(links[0]).toMatchObject({ expandable: false, items: undefined })
  })

  it('clears legacy status and label filters without losing a single project scope', () => {
    const saved: PersistedSessionViewFilters = {
      allSessions: {
        statuses: { done: 'include' },
        labels: { priority: 'exclude' },
        projects: { project: 'include' },
        groupingMode: 'status',
      },
    }
    expect(sanitizeRemovedSessionFilters(saved)).toEqual({
      allSessions: {
        statuses: {},
        labels: {},
        projects: { project: 'include' },
        groupingMode: 'date',
      },
    })
  })

  it('drops exclude and multi-project combos so they cannot ghost-filter the list (#263)', () => {
    expect(sanitizeSidebarProjectScope({ a: 'exclude' })).toEqual({})
    expect(sanitizeSidebarProjectScope({ a: 'include', b: 'exclude' })).toEqual({})
    expect(sanitizeSidebarProjectScope({ a: 'include', b: 'include' })).toEqual({})
    expect(sanitizeSidebarProjectScope({ a: 'include' })).toEqual({ a: 'include' })
  })

  it('maps every persisted grouping mode onto date (#263)', () => {
    expect(normalizeSessionGroupingMode('status')).toBe('date')
    expect(normalizeSessionGroupingMode('unread')).toBe('date')
    expect(normalizeSessionGroupingMode('project')).toBe('date')
    const unreadGrouped: PersistedSessionViewFilters = {
      allSessions: {
        statuses: {},
        labels: {},
        projects: { a: 'exclude' },
        groupingMode: 'unread',
      },
    }
    expect(sanitizeRemovedSessionFilters(unreadGrouped)).toEqual({
      allSessions: {
        statuses: {},
        labels: {},
        projects: {},
        groupingMode: 'date',
      },
    })
  })

  it('does not reconstruct classification or filter-menu entries in AppShell', () => {
    const appShell = readFileSync(join(import.meta.dir, 'AppShell.tsx'), 'utf8')
    expect(appShell).toContain('titleAlign="start"')
    expect(appShell).toContain('groupingMode="date"')
    expect(appShell).toContain('sanitizeRemovedSessionFilters(newViewFilters)')
    expect(appShell).toContain('sanitizeSidebarProjectScope(viewFiltersMap[sessionFilterKey]?.projects)')
    expect(appShell).not.toContain('id: "nav:flagged"')
    expect(appShell).not.toContain('id: "nav:archived"')
    expect(appShell).not.toContain("id: `nav:state:")
    expect(appShell).not.toContain('setChatGroupingMode')
    expect(appShell).not.toContain('legacyClassificationControlsEnabled')
    expect(appShell).not.toContain('CompactSessionListFilter')
    expect(appShell).not.toContain('ListFilter')
    expect(appShell).not.toContain('FilterModeBadge')
    expect(appShell).not.toContain('FilterModeSubMenuItems')
    expect(appShell).not.toContain('FilterMenuRow')
    expect(appShell).not.toContain('sidebar.filterChats')
  })

  it('does not render a project-scoped new-session bar inside SessionList (#215)', () => {
    const sessionList = readFileSync(join(import.meta.dir, 'SessionList.tsx'), 'utf8')

    // This is intentionally a structural source guard: the regression was an
    // extra EntityList header branch, while project inheritance is covered by
    // resolveSessionListNewSessionParams tests.
    expect(sessionList).not.toContain('newSessionProject')
    expect(sessionList).not.toContain('projectInfo.newSessionButton')
    expect(sessionList).not.toContain('<SquarePenRounded')
  })
})
