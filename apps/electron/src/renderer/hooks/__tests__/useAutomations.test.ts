import { describe, expect, it } from 'bun:test'
import type { TestAutomationResult } from '../../../shared/types'
import {
  AUTOMATION_TEST_MISSING_SESSION_ERROR,
  createAutomationRequestTracker,
  isCurrentAutomationLoad,
  resolveAutomationTestResult,
  shouldRefreshAutomations,
} from '../useAutomations'

describe('resolveAutomationTestResult', () => {
  it('selects the first successful prompt session as the navigation target', () => {
    const result: TestAutomationResult = {
      actions: [
        { type: 'prompt', success: true, sessionId: ' session-first ', duration: 10 },
        { type: 'prompt', success: true, sessionId: 'session-second', duration: 15 },
      ],
    }

    expect(resolveAutomationTestResult(result, true)).toEqual({
      testResult: { state: 'success', duration: 25 },
      sessionId: 'session-first',
      missingSessionId: false,
    })
  })

  it('reports a successful prompt that omitted its session id', () => {
    const result: TestAutomationResult = {
      actions: [{ type: 'prompt', success: true, duration: 5 }],
    }

    expect(resolveAutomationTestResult(result, true)).toEqual({
      testResult: {
        state: 'error',
        stderr: AUTOMATION_TEST_MISSING_SESSION_ERROR,
        duration: 5,
      },
      sessionId: undefined,
      missingSessionId: true,
    })
  })

  it('keeps a failed prompt error and does not misclassify it as a missing id', () => {
    const result: TestAutomationResult = {
      actions: [{ type: 'prompt', success: false, stderr: 'creation failed', duration: 7 }],
    }

    expect(resolveAutomationTestResult(result, true)).toEqual({
      testResult: { state: 'error', stderr: 'creation failed', duration: 7 },
      sessionId: undefined,
      missingSessionId: false,
    })
  })

  it('does not navigate after a successful webhook-only test', () => {
    const result: TestAutomationResult = {
      actions: [{ type: 'webhook', success: true, url: 'https://example.com', statusCode: 204, duration: 4 }],
    }

    expect(resolveAutomationTestResult(result, false)).toEqual({
      testResult: { state: 'success', duration: 4 },
      sessionId: undefined,
      missingSessionId: false,
    })
  })

  it('keeps a valid prompt target when another action fails', () => {
    const result: TestAutomationResult = {
      actions: [
        { type: 'prompt', success: true, sessionId: 'session-ok', duration: 3 },
        { type: 'webhook', success: false, url: 'https://example.com', statusCode: 500, error: 'webhook failed', duration: 8 },
      ],
    }

    expect(resolveAutomationTestResult(result, true)).toEqual({
      testResult: { state: 'error', stderr: 'webhook failed', duration: 11 },
      sessionId: 'session-ok',
      missingSessionId: false,
    })
  })
})

describe('createAutomationRequestTracker', () => {
  it('rejects a duplicate request synchronously until the first finishes', () => {
    const tracker = createAutomationRequestTracker()
    const token = tracker.begin('workspace:automation')

    expect(token).not.toBeNull()
    expect(tracker.begin('workspace:automation')).toBeNull()

    tracker.finish('workspace:automation', token!)
    expect(tracker.begin('workspace:automation')).not.toBeNull()
  })

  it('invalidates delayed responses on reset and does not let old tokens finish new runs', () => {
    const tracker = createAutomationRequestTracker()
    const oldToken = tracker.begin('workspace:automation')!

    tracker.reset()
    const newToken = tracker.begin('workspace:automation')!

    expect(tracker.isCurrent('workspace:automation', oldToken)).toBe(false)
    expect(tracker.isCurrent('workspace:automation', newToken)).toBe(true)

    tracker.finish('workspace:automation', oldToken)
    expect(tracker.isCurrent('workspace:automation', newToken)).toBe(true)
  })
})

describe('automation refresh race guards', () => {
  it('accepts only the latest response for the still-active workspace', () => {
    expect(isCurrentAutomationLoad('workspace-a', 2, 'workspace-a', 2)).toBe(true)
    expect(isCurrentAutomationLoad('workspace-a', 1, 'workspace-a', 2)).toBe(false)
    expect(isCurrentAutomationLoad('workspace-a', 2, 'workspace-b', 2)).toBe(false)
  })

  it('ignores change broadcasts for other workspaces', () => {
    expect(shouldRefreshAutomations('workspace-a', 'workspace-a')).toBe(true)
    expect(shouldRefreshAutomations('workspace-b', 'workspace-a')).toBe(false)
    expect(shouldRefreshAutomations('workspace-a', null)).toBe(false)
  })
})
