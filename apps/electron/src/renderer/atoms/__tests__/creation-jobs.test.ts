import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import {
  beginCreationJobAttemptAtom,
  claimCreationJob,
  claimCreationJobAtom,
  creationJobsAtom,
  creationJobsReducer,
  patchCreationJobAtom,
  restartCreationJobAttemptAtom,
  getOrCreateCreationSession,
  hasNewTerminalCreationOutput,
  isActiveCreationJob,
  resolveCreationSession,
  shouldCancelCreationJob,
  shouldValidateCreationJob,
  type CreationJob,
} from '../creation-jobs'
import {
  analyzeExplicitAutomationIds,
  diffSingleNewId,
  extractExplicitAutomationIds,
  readCreationIds,
  validateCreationJob,
} from '../../lib/creation-job-validation'

function job(overrides: Partial<CreationJob> = {}): CreationJob {
  return {
    id: 'job-1',
    workspaceId: 'workspace-1',
    contextKey: 'add-source',
    kind: 'source',
    status: 'running',
    phase: 'running',
    attempt: 1,
    baseline: ['existing'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('creation jobs', () => {
  test('reducer patches one job without changing its creation timestamp', () => {
    const next = creationJobsReducer([job()], {
      type: 'patch',
      id: 'job-1',
      now: 4,
      patch: { phase: 'validating' },
    })

    expect(next[0]).toMatchObject({ phase: 'validating', createdAt: 1, updatedAt: 4 })
  })

  test('claim dedupes an active job for the same workspace, context, and kind', () => {
    const existing = job()
    const claimed = claimCreationJob([existing], {
      workspaceId: existing.workspaceId,
      contextKey: existing.contextKey,
      kind: existing.kind,
      baseline: [],
      id: 'job-2',
      now: 2,
    })

    expect(claimed.deduped).toBe(true)
    expect(claimed.job.id).toBe('job-1')
    expect(claimed.jobs).toHaveLength(1)
  })

  test('claim serializes the same resource kind across context variants', () => {
    const existing = job({ contextKey: 'add-source-api' })
    const claimed = claimCreationJob([existing], {
      workspaceId: existing.workspaceId,
      contextKey: 'add-source-mcp',
      kind: existing.kind,
      baseline: [],
      id: 'job-2',
      now: 2,
    })

    expect(claimed.deduped).toBe(true)
    expect(claimed.job.id).toBe(existing.id)
  })

  test('promise-level dedupe creates only one hidden session', async () => {
    let calls = 0
    const create = async () => {
      calls += 1
      await Promise.resolve()
      return 'session-1'
    }

    const [first, second] = await Promise.all([
      getOrCreateCreationSession('job-promise', create),
      getOrCreateCreationSession('job-promise', create),
    ])
    expect(first).toBe('session-1')
    expect(second).toBe('session-1')
    expect(calls).toBe(1)
  })

  test('closing or navigating never means cancellation', () => {
    expect(shouldCancelCreationJob('close')).toBe(false)
    expect(shouldCancelCreationJob('route-change')).toBe(false)
    expect(shouldCancelCreationJob('explicit-stop')).toBe(true)
  })

  test('waiting-input reuses its session without restarting validation', () => {
    const waiting = job({
      status: 'waiting-input',
      phase: 'waiting-input',
      sessionId: 'session-1',
    })
    expect(isActiveCreationJob(waiting)).toBe(true)
    expect(resolveCreationSession(waiting)).toEqual({ type: 'reuse', sessionId: 'session-1' })
    expect(shouldValidateCreationJob(waiting)).toBe(false)
    expect(shouldValidateCreationJob(job({ status: 'failed', phase: 'failed' }))).toBe(false)
    expect(shouldValidateCreationJob(job({ sessionId: 'session-1' }))).toBe(true)
  })

  test('grants only one racing caller the next waiting-input send attempt', () => {
    const store = createStore()
    const claimed = store.set(claimCreationJobAtom, {
      workspaceId: 'workspace-1',
      contextKey: 'add-source',
      kind: 'source' as const,
      baseline: [],
      request: 'first request',
      id: 'job-atomic',
      now: 1,
    })
    store.set(patchCreationJobAtom, {
      id: claimed.job.id,
      patch: { status: 'waiting-input', phase: 'waiting-input', sessionId: 'session-1' },
      now: 2,
    })

    const first = store.set(beginCreationJobAttemptAtom, {
      id: claimed.job.id,
      request: 'follow up',
      now: 3,
    })
    const second = store.set(beginCreationJobAttemptAtom, {
      id: claimed.job.id,
      request: 'duplicate follow up',
      now: 3,
    })

    expect(first).toMatchObject({ status: 'running', attempt: 2, request: 'follow up' })
    expect(second).toBeNull()
  })

  test('failed retry is atomic and preserves its original baseline', () => {
    const store = createStore()
    const claimed = store.set(claimCreationJobAtom, {
      workspaceId: 'workspace-1',
      contextKey: 'add-automation',
      kind: 'automation' as const,
      baseline: ['existing-id'],
      request: 'create it',
      id: 'job-retry',
      now: 1,
    })
    store.set(patchCreationJobAtom, {
      id: claimed.job.id,
      patch: {
        sessionId: 'session-1',
        status: 'failed',
        phase: 'failed',
        error: 'schema invalid',
      },
      now: 2,
    })

    const first = store.set(restartCreationJobAttemptAtom, {
      id: claimed.job.id,
      request: 'fix the schema',
      now: 3,
    })
    const second = store.set(restartCreationJobAttemptAtom, {
      id: claimed.job.id,
      request: 'duplicate retry',
      now: 3,
    })

    expect(first).toMatchObject({
      status: 'running',
      phase: 'running',
      attempt: 2,
      baseline: ['existing-id'],
      request: 'fix the schema',
    })
    expect(second).toBeNull()
  })

  test('failed retry cannot bypass workspace-and-kind serialization', () => {
    const store = createStore()
    store.set(creationJobsAtom, [
      job({
        id: 'failed-api',
        contextKey: 'add-source-api',
        status: 'failed',
        phase: 'failed',
        sessionId: 'session-api',
      }),
      job({
        id: 'running-mcp',
        contextKey: 'add-source-mcp',
        status: 'running',
        phase: 'running',
        sessionId: 'session-mcp',
      }),
    ])

    expect(store.set(restartCreationJobAttemptAtom, {
      id: 'failed-api',
      request: 'retry api',
      now: 3,
    })).toBeNull()
  })

  test('CAS patch rejects stale validation and cancellation results', () => {
    const store = createStore()
    const claimed = store.set(claimCreationJobAtom, {
      workspaceId: 'workspace-1',
      contextKey: 'add-source',
      kind: 'source' as const,
      baseline: [],
      id: 'job-cas',
      now: 1,
    })
    const started = store.set(patchCreationJobAtom, {
      id: claimed.job.id,
      expectedAttempt: 1,
      expectedStatus: 'running',
      expectedPhase: 'preparing',
      patch: { phase: 'validating' },
      now: 2,
    })
    const cancelled = store.set(patchCreationJobAtom, {
      id: claimed.job.id,
      expectedAttempt: 1,
      expectedStatus: 'running',
      patch: { status: 'cancelled', phase: 'cancelled' },
      now: 3,
    })
    const staleCompletion = store.set(patchCreationJobAtom, {
      id: claimed.job.id,
      expectedAttempt: 1,
      expectedStatus: 'running',
      expectedPhase: 'validating',
      patch: { status: 'completed', phase: 'completed', result: { id: 'new' } },
      now: 4,
    })

    expect(started).toBe(true)
    expect(cancelled).toBe(true)
    expect(staleCompletion).toBe(false)
  })

  test('does not validate a stale terminal message when reusing a session', () => {
    const reused = job({
      sessionId: 'session-1',
      baselineFinalMessageId: 'assistant-old',
      baselineMessageRole: 'assistant',
      observedProcessing: false,
    })
    expect(hasNewTerminalCreationOutput(reused, {
      lastFinalMessageId: 'assistant-old',
      lastMessageRole: 'assistant',
    })).toBe(false)
    expect(hasNewTerminalCreationOutput(reused, {
      lastFinalMessageId: 'assistant-new',
      lastMessageRole: 'assistant',
    })).toBe(true)
    expect(hasNewTerminalCreationOutput({ ...reused, observedProcessing: true }, {
      lastFinalMessageId: 'assistant-old',
      lastMessageRole: 'assistant',
    })).toBe(true)
  })
})

describe('creation result validation', () => {
  test('requires exactly one new persisted id', () => {
    expect(diffSingleNewId(['a'], ['a', 'b'])).toEqual({ id: 'b' })
    expect(diffSingleNewId(['a'], ['a']).error).toContain('no new explicit')
    expect(diffSingleNewId(['a'], ['a', 'b', 'c']).error).toContain('multiple resources')
  })

  test('extracts only explicit automation ids and dedupes them', () => {
    const ids = extractExplicitAutomationIds({
      automations: {
        SessionStart: [{ id: 'a1b2c3' }, { name: 'fallback is not an id' }],
        Cron: [{ id: ' d4e5f6 ' }, { id: 'a1b2c3' }, null],
      },
    })
    expect(ids).toEqual(['a1b2c3', 'd4e5f6'])
  })

  test('reports duplicate automation ids without rejecting legacy id formats', () => {
    expect(analyzeExplicitAutomationIds({
      automations: {
        SessionStart: [{ id: 'a1b2c3' }, { id: 'a1b2c3' }],
        Cron: [{ id: 'not-hex' }, { id: 'ABC123' }],
      },
    })).toEqual({
      ids: ['ABC123', 'a1b2c3', 'not-hex'],
      duplicateIds: ['a1b2c3'],
    })
  })

  test('requires persisted automation schema validation before accepting ids', async () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electronAPI: {
          getAutomations: async () => ({
            version: 2,
            automations: { SchedulerTick: [{ id: 'a1b2c3', actions: [] }] },
          }),
          validateAutomations: async () => ({
            valid: false,
            errors: ['At least one action required'],
            registeredIds: [],
          }),
        },
      },
    })

    try {
      await expect(readCreationIds('automation', 'workspace-1', true)).rejects.toThrow('At least one action required')
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })

  test('rejects a newly persisted automation id outside the canonical format', async () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electronAPI: {
          getAutomations: async () => ({
            version: 2,
            automations: { SchedulerTick: [{ id: 'custom-id', actions: [{ type: 'prompt', prompt: 'hi' }] }] },
          }),
          validateAutomations: async () => ({ valid: true, errors: [], registeredIds: ['custom-id'] }),
        },
      },
    })

    try {
      const result = await validateCreationJob(job({ kind: 'automation', baseline: [] }))
      expect(result.id).toBeUndefined()
      expect(result.error).toContain('six lowercase hexadecimal')
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })
})
