import { describe, expect, it } from 'bun:test'
import type { FilterMode } from './inherited-filter-params'
import {
  filterSessionsByProject,
  getIncludedProjectName,
  hasIncludedProjectFilter,
} from './project-session-filter'

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

describe('getIncludedProjectName (#243)', () => {
  const projects = [
    { config: { id: 'project-1', name: 'Project One' } },
    { config: { id: 'project-2', name: 'Project Two' } },
  ]

  it('uses the selected project name for a single included project', () => {
    expect(getIncludedProjectName(m(['project-1', 'include']), projects)).toBe('Project One')
  })

  it('does not choose an ambiguous title for multiple included projects', () => {
    expect(getIncludedProjectName(m(
      ['project-1', 'include'],
      ['project-2', 'include'],
    ), projects)).toBeUndefined()
  })

  it('falls back when the filter has no included project or the project is missing', () => {
    expect(getIncludedProjectName(m(), projects)).toBeUndefined()
    expect(getIncludedProjectName(m(['project-1', 'exclude']), projects)).toBeUndefined()
    expect(getIncludedProjectName(m(['missing', 'include']), projects)).toBeUndefined()
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
