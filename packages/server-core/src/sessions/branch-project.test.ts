import { describe, expect, it } from 'bun:test'
import { resolveSessionProjectId } from './SessionManager'

describe('branch project binding', () => {
  it('keeps a project branch in its source project', () => {
    expect(resolveSessionProjectId({ branchSourceProjectId: 'source-project' })).toBe('source-project')
    expect(resolveSessionProjectId({ branchSourceProjectId: 'source-project',
      requestedProjectId: 'source-project' })).toBe('source-project')
  })

  it('rejects moving a branch to a different project', () => {
    expect(() => resolveSessionProjectId({ branchSourceProjectId: 'source-project',
      requestedProjectId: 'other-project' })).toThrow('A branch must stay in its source session project')
  })

  it('preserves ordinary and child session binding', () => {
    expect(resolveSessionProjectId({})).toBeUndefined()
    expect(resolveSessionProjectId({ parentProjectId: 'parent-project' })).toBe('parent-project')
    expect(resolveSessionProjectId({ requestedProjectId: 'explicit-project',
      parentProjectId: 'parent-project' })).toBe('explicit-project')
  })
})
