import { describe, expect, it, mock } from 'bun:test'
import { canRetryErrorInPlace, handleErrorMessageAction, type ErrorMessageAction } from '../error-message-actions'

describe('handleErrorMessageAction', () => {
  it('routes retry through the session-scoped focus handler', () => {
    const onRetryFocus = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'r',
      label: 'Retry',
      action: 'retry',
    }

    handleErrorMessageAction(action, {
      sessionId: 'session-123',
      onRetryFocus,
    })

    expect(onRetryFocus).toHaveBeenCalledTimes(1)
    expect(onRetryFocus).toHaveBeenCalledWith({ sessionId: 'session-123' })
  })

  it('opens the provided URL for open_url actions', () => {
    const onOpenUrl = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'docs',
      label: 'Open docs',
      action: 'open_url',
      url: 'https://example.com/status',
    }

    handleErrorMessageAction(action, { onOpenUrl })

    expect(onOpenUrl).toHaveBeenCalledTimes(1)
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/status')
  })

  it('calls onRetry instead of onRetryFocus when provided', () => {
    const onRetry = mock(() => {})
    const onRetryFocus = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'r',
      label: 'Retry',
      action: 'retry',
    }

    handleErrorMessageAction(action, {
      sessionId: 'session-123',
      onRetry,
      onRetryFocus,
    })

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetryFocus).not.toHaveBeenCalled()
  })

  it('runs the settings handler for settings actions', () => {
    const onOpenSettings = mock(() => {})
    const action: ErrorMessageAction = {
      key: 'settings',
      label: 'Settings',
      action: 'settings',
    }

    handleErrorMessageAction(action, { onOpenSettings })

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})

describe('canRetryErrorInPlace', () => {
  const user = { id: 'user-1', role: 'user' as const, content: 'original question', timestamp: 1 }
  const error = { id: 'error-1', role: 'error' as const, content: 'failed', timestamp: 2 }

  it('allows the latest failed user turn to be retried in place', () => {
    expect(canRetryErrorInPlace([user, error], error.id)).toBe(true)
  })

  it('does not redirect a historical error retry to a newer user turn', () => {
    expect(canRetryErrorInPlace([
      user,
      error,
      { id: 'user-2', role: 'user', content: 'newer question', timestamp: 3 },
    ], error.id)).toBe(false)
  })

  it('does not retry a hidden continuation instead of the visible question', () => {
    expect(canRetryErrorInPlace([
      user,
      error,
      { id: 'hidden-user', role: 'user', content: 'internal continuation', hidden: true, timestamp: 3 },
    ], error.id)).toBe(false)
  })
})
