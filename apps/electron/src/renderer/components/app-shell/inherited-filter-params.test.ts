import { describe, it, expect } from 'bun:test'
import {
  resolveInheritedFilterParams,
  resolveNewSessionParams,
  resolveProjectNavigationSessionId,
  type FilterMode,
} from './inherited-filter-params'

const m = (...entries: [string, FilterMode][]) => new Map(entries)

describe('resolveInheritedFilterParams (#970)', () => {
  it('inherits a sole include-mode status', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include']), m(), m())).toEqual({ status: 'todo' })
  })

  it('does NOT inherit an excluded status (the bug)', () => {
    // With only `Done → exclude`, a new session must fall back to the workspace
    // default, not be created as Done.
    expect(resolveInheritedFilterParams(m(['done', 'exclude']), m(), m())).toBeNull()
  })

  it('counts only includes — a single include alongside an exclude still inherits the include', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include'], ['done', 'exclude']), m(), m())).toEqual({ status: 'todo' })
  })

  it('returns null for multiple includes (ambiguous)', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include'], ['wip', 'include']), m(), m())).toBeNull()
  })

  it('inherits a sole include label or project', () => {
    expect(resolveInheritedFilterParams(m(), m(['bug', 'include']), m())).toEqual({ label: 'bug' })
    expect(resolveInheritedFilterParams(m(), m(), m(['proj1', 'include']))).toEqual({ project: 'proj1' })
  })

  it('returns null with no filters', () => {
    expect(resolveInheritedFilterParams(m(), m(), m())).toBeNull()
  })

  it('returns null for cross-dimension ambiguity (one status + one label include)', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include']), m(['bug', 'include']), m())).toBeNull()
  })
})

describe('resolveNewSessionParams (#145)', () => {
  it('binds a new session to the project selected in the Projects navigator', () => {
    expect(resolveNewSessionParams(m(), m(), m(), 'proj-selected')).toEqual({ project: 'proj-selected' })
  })

  it('prefers the selected project over stale session-list filters', () => {
    expect(
      resolveNewSessionParams(
        m(['todo', 'include']),
        m(['bug', 'include']),
        m(['proj-filter', 'include']),
        'proj-selected',
      ),
    ).toEqual({ project: 'proj-selected' })
  })

  it('preserves sole-filter inheritance outside the Projects navigator', () => {
    expect(resolveNewSessionParams(m(), m(['bug', 'include']), m(), null)).toEqual({ label: 'bug' })
  })
})

describe('resolveProjectNavigationSessionId (#145)', () => {
  it('selects only a session already bound to the project', () => {
    const sessions = [
      { id: 'global' },
      { id: 'other', projectId: 'proj-other' },
      { id: 'selected', projectId: 'proj-selected' },
    ]

    expect(resolveProjectNavigationSessionId(sessions, 'proj-selected')).toBe('selected')
  })

  it('does not fall back to a global session when the project is empty', () => {
    expect(resolveProjectNavigationSessionId([{ id: 'global' }], 'proj-selected')).toBeNull()
  })

  it('does not auto-select a detail that may be hidden by other filters', () => {
    expect(
      resolveProjectNavigationSessionId(
        [{ id: 'selected', projectId: 'proj-selected' }],
        'proj-selected',
        true,
      ),
    ).toBeNull()
  })
})
