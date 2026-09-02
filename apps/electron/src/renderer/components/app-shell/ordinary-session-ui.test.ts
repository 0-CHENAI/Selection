import { describe, expect, it } from 'bun:test'
import {
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
})
