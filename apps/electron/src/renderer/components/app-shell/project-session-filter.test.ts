import { describe, expect, it } from 'bun:test'
import type { FilterMode } from './inherited-filter-params'
import { filterSessionsByProject, hasIncludedProjectFilter } from './project-session-filter'

const m = (...entries: [string, FilterMode][]) => new Map(entries)
const sessions = [
  { id: 'in-project-1', projectId: 'project-1' },
  { id: 'in-project-2', projectId: 'project-2' },
  { id: 'unbound' },
]

const matchingIds = (filter: Map<string, FilterMode>) =>
  filterSessionsByProject(sessions, filter).map(session => session.id)

describe('hasIncludedProjectFilter (#165)', () => {
  it('treats an included project as the active sidebar child', () => {
    expect(hasIncludedProjectFilter(m(['project-1', 'include']))).toBe(true)
  })

  it('keeps All Sessions active for empty or exclude-only project filters', () => {
    expect(hasIncludedProjectFilter(m())).toBe(false)
    expect(hasIncludedProjectFilter(m(['project-1', 'exclude']))).toBe(false)
  })
})

describe('filterSessionsByProject (#149)', () => {
  it('shows only sessions bound to an included project', () => {
    expect(matchingIds(m(['project-1', 'include']))).toEqual(['in-project-1'])
  })

  it('keeps other and unbound sessions when a project is excluded', () => {
    expect(matchingIds(m(['project-1', 'exclude']))).toEqual(['in-project-2', 'unbound'])
  })

  it('accepts any of multiple included projects', () => {
    expect(matchingIds(m(
      ['project-1', 'include'],
      ['project-2', 'include']
    ))).toEqual(['in-project-1', 'in-project-2'])
  })

  it('returns the complete list when no project filter is active', () => {
    expect(matchingIds(m())).toEqual(['in-project-1', 'in-project-2', 'unbound'])
  })
})
