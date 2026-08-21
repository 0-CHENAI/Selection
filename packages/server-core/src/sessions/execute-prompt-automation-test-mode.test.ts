import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager } from './SessionManager.ts'

// Regression test for craft-agents-oss#943:
//
//   The automation "Test" action awaited executePromptAutomation → sendMessage
//   to *full* completion. A prompt that used tools or produced >30s of output
//   tripped the 30s RPC client timeout and reported failure even though the
//   session streamed fine.
//
// The fix adds `waitForCompletion` to ExecutePromptAutomationInput. The Test
// handler passes `false` so the method returns once the session is created and
// the prompt is dispatched (fire-and-forget, error-logged). Real automation
// execution omits the flag and keeps awaiting completion.
//
// These tests stub the heavy collaborators (createSession / sendEvent /
// sendMessage) and lock the branch: waitForCompletion:false resolves even when
// sendMessage never settles; the default still awaits (and propagates errors).

describe('executePromptAutomation waitForCompletion', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'exec-prompt-automation-'))
    sm = new SessionManager()
    // Stub the collaborators executePromptAutomation touches. With no labels /
    // mentions / llmConnection in the input, everything else is skipped.
    ;(sm as unknown as { createSession: unknown }).createSession = async () => ({ id: 'test-sess' })
    ;(sm as unknown as { sendEvent: unknown }).sendEvent = () => {}
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('waitForCompletion:false returns as soon as the session is created (does not await the turn)', async () => {
    let sendCalled = false
    // Never-resolving send simulates a long tool-using turn.
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = () => {
      sendCalled = true
      return new Promise<never>(() => {})
    }

    const result = await sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'do something long',
      waitForCompletion: false,
    })

    expect(result.sessionId).toBe('test-sess')
    expect(sendCalled).toBe(true)
  })

  it('default (waitForCompletion unset) awaits sendMessage and propagates its error', async () => {
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = () =>
      Promise.reject(new Error('send failed'))

    await expect(
      sm.executePromptAutomation({
        workspaceId: 'ws_test',
        workspaceRootPath: tmpRoot,
        prompt: 'do something',
      }),
    ).rejects.toThrow('send failed')
  })

  it('waitForCompletion:true waits for onSessionComplete and records duration', async () => {
    const listeners: Array<(evt: { sessionId: string; reason: 'complete' }) => void> = []
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = () => Promise.resolve()
    ;(sm as unknown as { onSessionComplete: unknown }).onSessionComplete = (listener: (evt: { sessionId: string; reason: 'complete' }) => void) => {
      listeners.push(listener)
      return () => {}
    }

    const pending = sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'wait for me',
      waitForCompletion: true,
      timeoutMs: 5_000,
    })

    await Promise.resolve()
    expect(listeners).toHaveLength(1)
    listeners[0]!({ sessionId: 'test-sess', reason: 'complete' })

    const result = await pending
    expect(result.waitReason).toBe('complete')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('times out waitForCompletion without throwing', async () => {
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = () => new Promise<never>(() => {})
    ;(sm as unknown as { onSessionComplete: unknown }).onSessionComplete = () => () => {}

    const result = await sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'never finishes',
      waitForCompletion: true,
      timeoutMs: 20,
    })

    expect(result.waitReason).toBe('timeout')
    expect(result.sessionId).toBe('test-sess')
  })

  it('waitForCompletion treats a sendMessage failure as error without waiting out the timeout', async () => {
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = () => Promise.reject(new Error('boom'))
    ;(sm as unknown as { onSessionComplete: unknown }).onSessionComplete = () => () => {}

    const started = Date.now()
    const result = await sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'fails immediately',
      waitForCompletion: true,
      timeoutMs: 5_000,
    })

    expect(result.waitReason).toBe('error')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('reportBack waits until the source session is idle before writing back', async () => {
    const sessions = new Map<string, { isProcessing: boolean }>([
      ['source-1', { isProcessing: true }],
    ])
    ;(sm as unknown as { sessions: Map<string, { isProcessing: boolean }> }).sessions = sessions

    const sent: string[] = []
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = (sessionId: string) => {
      sent.push(sessionId)
      return Promise.resolve()
    }

    const listeners: Array<(evt: { sessionId: string; reason: 'complete' }) => void> = []
    ;(sm as unknown as { onSessionComplete: unknown }).onSessionComplete = (listener: (evt: { sessionId: string; reason: 'complete' }) => void) => {
      listeners.push(listener)
      return () => {}
    }

    const pending = sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'report',
      reportBack: true,
      sourceSessionId: 'source-1',
      automationName: 'Relay',
      timeoutMs: 5_000,
    })

    await Promise.resolve()
    expect(listeners).toHaveLength(1)
    listeners[0]!({ sessionId: 'test-sess', reason: 'complete' })
    const startedWait = Date.now()
    while (listeners.length < 2 && Date.now() - startedWait < 200) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(sent).toEqual(['test-sess'])
    expect(listeners).toHaveLength(2)

    sessions.set('source-1', { isProcessing: false })
    listeners[1]!({ sessionId: 'source-1', reason: 'complete' })

    const result = await pending
    expect(result.reportBackError).toBeUndefined()
    expect(sent).toEqual(['test-sess', 'source-1'])
  })

  it('reportBack skips write-back when the child wait is not complete', async () => {
    const sent: string[] = []
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = (sessionId: string) => {
      sent.push(sessionId)
      return Promise.resolve()
    }
    ;(sm as unknown as { onSessionComplete: unknown }).onSessionComplete = (listener: (evt: { sessionId: string; reason: 'error' }) => void) => {
      queueMicrotask(() => listener({ sessionId: 'test-sess', reason: 'error' }))
      return () => {}
    }

    const result = await sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'report',
      reportBack: true,
      sourceSessionId: 'source-1',
      timeoutMs: 1_000,
    })

    expect(result.waitReason).toBe('error')
    expect(result.reportBackError).toBeUndefined()
    expect(sent).toEqual(['test-sess'])
  })

  it('reportBack fails when the source session is missing', async () => {
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = () => Promise.resolve()
    ;(sm as unknown as { onSessionComplete: unknown }).onSessionComplete = (listener: (evt: { sessionId: string; reason: 'complete' }) => void) => {
      queueMicrotask(() => listener({ sessionId: 'test-sess', reason: 'complete' }))
      return () => {}
    }

    const result = await sm.executePromptAutomation({
      workspaceId: 'ws_test',
      workspaceRootPath: tmpRoot,
      prompt: 'report',
      reportBack: true,
      sourceSessionId: 'missing-source',
      timeoutMs: 1_000,
    })

    expect(result.reportBackError).toBe('source session unavailable')
  })
})
