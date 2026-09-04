import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeSessionGroupingMode,
  prepareOrdinarySessionSidebarLinks,
  sanitizeRemovedSessionFilters,
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

  it('clears legacy status and label filters without losing project scope', () => {
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

  it('maps persisted status grouping onto date', () => {
    expect(normalizeSessionGroupingMode('status')).toBe('date')
    expect(normalizeSessionGroupingMode('unread')).toBe('unread')
  })

  it('does not reconstruct classification entries in AppShell', () => {
    const appShell = readFileSync(join(import.meta.dir, 'AppShell.tsx'), 'utf8')
    expect(appShell).toContain('titleAlign="start"')
    expect(appShell).not.toContain('id: "nav:flagged"')
    expect(appShell).not.toContain('id: "nav:archived"')
    expect(appShell).not.toContain("id: `nav:state:")
    expect(appShell).not.toContain("setChatGroupingMode('status')")
    expect(appShell).not.toContain('legacyClassificationControlsEnabled')
    expect(appShell).not.toContain('CompactSessionListFilter')
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
