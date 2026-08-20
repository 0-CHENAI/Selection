import { describe, expect, it } from 'bun:test'
import {
  buildBackgroundTaskNudge,
  countRunningSpawnChildren,
  mapCompletionReasonToSpawnStatus,
  mapCompletionReasonToTaskStatus,
  shouldDeferSpawnWake,
  shouldOrphanBackgroundTask,
  shouldWakeOnTaskCompleted,
  waitForChildSessionCompletion,
} from './spawn-session-orchestration.ts'

describe('spawn-session orchestration helpers', () => {
  it('maps completion reasons', () => {
    expect(mapCompletionReasonToSpawnStatus('complete')).toBe('completed')
    expect(mapCompletionReasonToSpawnStatus('interrupted')).toBe('interrupted')
    expect(mapCompletionReasonToSpawnStatus('error')).toBe('failed')
    expect(mapCompletionReasonToTaskStatus('complete')).toBe('completed')
    expect(mapCompletionReasonToTaskStatus('interrupted')).toBe('stopped')
    expect(mapCompletionReasonToTaskStatus('timeout')).toBe('failed')
  })

  it('counts only running spawn_session children', () => {
    expect(countRunningSpawnChildren({
      registry: [
        { taskId: 'a', status: 'running', source: 'spawn_session' },
        { taskId: 'b', status: 'running', source: 'spawn_session' },
        { taskId: 'c', status: 'completed', source: 'spawn_session' },
        { taskId: 'd', status: 'running' },
      ],
    })).toBe(2)
    expect(countRunningSpawnChildren({ registry: [] })).toBe(0)
  })

  it('includes wait-mode live children that are not in the registry', () => {
    expect(countRunningSpawnChildren({
      registry: [],
      parentId: 'parent',
      sessions: [
        { id: 'parent', isProcessing: true },
        { id: 'wait-child', isProcessing: true, parentSessionId: 'parent' },
      ],
    })).toBe(1)
  })

  it('does not double-count a background child that is both registered and live', () => {
    expect(countRunningSpawnChildren({
      registry: [{ taskId: 'child', status: 'running', source: 'spawn_session' }],
      parentId: 'parent',
      sessions: [
        { id: 'child', isProcessing: true, parentSessionId: 'parent' },
      ],
    })).toBe(1)
  })

  it('skips stale registry entries whose live session is idle', () => {
    expect(countRunningSpawnChildren({
      registry: [{ taskId: 'stale', status: 'running', source: 'spawn_session' }],
      parentId: 'parent',
      sessions: [
        { id: 'stale', isProcessing: false, parentSessionId: 'parent' },
      ],
    })).toBe(0)
  })

  it('does not count Conductor node sessions as spawn children', () => {
    expect(countRunningSpawnChildren({
      registry: [],
      parentId: 'orch',
      sessions: [
        { id: 'node-1', isProcessing: true, parentSessionId: 'orch', taskNodeId: 'n1' },
      ],
    })).toBe(0)
  })

  it('never orphans spawn_session children', () => {
    expect(shouldOrphanBackgroundTask({ status: 'running', source: 'spawn_session' }, false)).toBe(false)
    expect(shouldOrphanBackgroundTask({ status: 'running' }, false)).toBe(true)
    expect(shouldOrphanBackgroundTask({ status: 'running' }, true)).toBe(false)
  })

  it('wakes spawn children even when keep-alive is off', () => {
    expect(shouldWakeOnTaskCompleted({
      isProcessing: false,
      wasAlreadyTerminal: false,
      keepAlive: false,
      source: 'spawn_session',
    })).toBe(true)
    expect(shouldWakeOnTaskCompleted({
      isProcessing: false,
      wasAlreadyTerminal: false,
      keepAlive: false,
    })).toBe(false)
    expect(shouldWakeOnTaskCompleted({
      isProcessing: true,
      wasAlreadyTerminal: false,
      keepAlive: true,
      source: 'spawn_session',
    })).toBe(false)
    expect(shouldDeferSpawnWake({
      isProcessing: true,
      wasAlreadyTerminal: false,
      source: 'spawn_session',
    })).toBe(true)
    expect(shouldDeferSpawnWake({
      isProcessing: false,
      wasAlreadyTerminal: false,
      source: 'spawn_session',
    })).toBe(false)
  })

  it('builds a session-id nudge without telling the model to re-spawn', () => {
    const nudge = buildBackgroundTaskNudge({
      status: 'completed',
      taskId: 'child-1',
      intent: 'Find auth',
      summary: 'Found three files',
    })
    expect(nudge).toContain('Session ID: child-1')
    expect(nudge).toContain('Found three files')
    expect(nudge).toContain('get_session_info')
    expect(nudge).toContain('Do NOT spawn another background session')
    expect(nudge).not.toContain('Read that output file')
  })

  it('wait resolves on child completion, timeout, and parent interrupt', async () => {
    const listeners = new Set<(evt: { sessionId: string; reason: 'complete' | 'interrupted' | 'error' | 'timeout'; finalText?: string }) => void>()
    const subscribe = (listener: (evt: { sessionId: string; reason: 'complete' | 'interrupted' | 'error' | 'timeout'; finalText?: string }) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    const done = waitForChildSessionCompletion({
      childSessionId: 'c1',
      timeoutMs: 5_000,
      isParentInterrupted: () => false,
      subscribe,
    })
    for (const listener of listeners) listener({ sessionId: 'c1', reason: 'complete', finalText: 'ok' })
    await expect(done).resolves.toEqual({ status: 'completed', finalText: 'ok' })

    const timedOut = waitForChildSessionCompletion({
      childSessionId: 'c2',
      timeoutMs: 20,
      isParentInterrupted: () => false,
      subscribe,
    })
    await expect(timedOut).resolves.toEqual({ status: 'timeout' })

    let interrupted = false
    const aborting = waitForChildSessionCompletion({
      childSessionId: 'c3',
      timeoutMs: 5_000,
      isParentInterrupted: () => interrupted,
      subscribe,
    })
    interrupted = true
    await expect(aborting).resolves.toEqual({ status: 'interrupted' })

    let settleEarly: ((result: { status: 'failed' }) => void) | undefined
    const failed = waitForChildSessionCompletion({
      childSessionId: 'c4',
      timeoutMs: 5_000,
      isParentInterrupted: () => false,
      subscribe,
      onAttach: (settle) => { settleEarly = settle },
    })
    settleEarly?.({ status: 'failed' })
    await expect(failed).resolves.toEqual({ status: 'failed' })
  })
})
