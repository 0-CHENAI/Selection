import { describe, expect, test } from 'bun:test'
import { automationCreationKey } from '../creation-context'
import { claimCreationJob, findResumableCreationJob, type CreationJob } from '../../../atoms/creation-jobs'

function draft(category: 'scheduled' | 'event' | 'agentic', overrides: Partial<CreationJob> = {}): CreationJob {
  return {
    id: category, kind: 'automation', workspaceId: 'workspace',
    contextKey: automationCreationKey(category), sessionId: `${category}-session`,
    status: 'waiting-input', phase: 'waiting-input', attempt: 1,
    baseline: ['existing-rule'], request: `Create ${category}`, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

describe('automation creation context isolation (#362)', () => {
  test('navigation and list filters resolve to the same category-specific draft', () => {
    expect(automationCreationKey('app')).toBe(automationCreationKey('event'))
    expect(automationCreationKey('agent')).toBe(automationCreationKey('agentic'))
    expect(new Set(['scheduled', 'event', 'agentic', 'all'].map(category =>
      automationCreationKey(category as 'scheduled' | 'event' | 'agentic' | 'all'))).size).toBe(4)
  })

  test('opening event creation does not restore a scheduled conversation', () => {
    expect(findResumableCreationJob([draft('scheduled')], 'workspace', automationCreationKey('event'))).toBeUndefined()
  })

  test('returning to a category restores its submitted request and session, even if another category was used more recently', () => {
    const scheduled = draft('scheduled')
    const jobs = [scheduled, draft('event', { updatedAt: 10 })]
    expect(findResumableCreationJob(jobs, 'workspace', automationCreationKey('scheduled'))).toBe(scheduled)
  })

  test('workspace boundaries and legacy generic drafts do not leak into categories', () => {
    const jobs = [draft('event', { workspaceId: 'other' }), draft('scheduled', { contextKey: 'add-automation' })]
    expect(findResumableCreationJob(jobs, 'workspace', automationCreationKey('event'))).toBeUndefined()
  })

  test('completed creation starts fresh instead of reusing an existing rule conversation', () => {
    const jobs = [draft('scheduled', { status: 'completed', phase: 'completed' })]
    expect(findResumableCreationJob(jobs, 'workspace', automationCreationKey('scheduled'))).toBeUndefined()
    const claim = claimCreationJob(jobs, {
      workspaceId: 'workspace', contextKey: automationCreationKey('scheduled'),
      kind: 'automation', baseline: ['existing-rule', 'newly-created-rule'], id: 'next',
    })
    expect(claim.deduped).toBe(false)
    expect(claim.job.sessionId).toBeUndefined()
    expect(claim.jobs.find(job => job.id === 'scheduled')).toEqual(jobs[0])
  })

  test('failed creations remain resumable for repair with the original baseline', () => {
    const failed = draft('event', { status: 'failed', phase: 'failed' })
    expect(findResumableCreationJob([failed], 'workspace', failed.contextKey)).toBe(failed)
  })

  test('category isolation keeps the shared-file write lock', () => {
    const existing = draft('scheduled', { status: 'running', phase: 'validating' })
    const claim = claimCreationJob([existing], {
      workspaceId: 'workspace', contextKey: automationCreationKey('event'), kind: 'automation', baseline: [],
    })
    expect(claim.deduped).toBe(true)
    expect(claim.job).toBe(existing)
  })
})
