import { expect, it } from 'bun:test'
import { handleComplete, handleError, handleStatus } from '../session'
import type { SessionState } from '../../types'

const retryingState = { session: { id: 's', workspaceId: 'ws', workspaceName: 'Workspace',
  lastMessageAt: 0, isProcessing: true, messages: [
    { id: 'retry-1', role: 'status', content: 'Retrying (attempt 1/3)...', timestamp: 1 },
    { id: 'retry-2', role: 'status', content: 'Retrying (attempt 2/3)...', timestamp: 2 },
    { id: 'tool-1', role: 'tool', content: '', toolStatus: 'completed', timestamp: 3 },
  ], currentStatus: { message: 'Retrying (attempt 2/3)...' } },
  streaming: null } satisfies SessionState

it('clears a recovered retry status without an empty activity or stopping active work', () => {
  const result = handleStatus(retryingState, { type: 'status', sessionId: 's', message: '' })
  expect(result.state.session.currentStatus).toBeUndefined()
  expect(result.state.session.messages).toEqual([retryingState.session.messages[2]])
  expect(result.state.session.isProcessing).toBe(true)
});

it('removes retry statuses when a run completes before an explicit clear event', () => {
  const result = handleComplete(retryingState, { type: 'complete', sessionId: 's' })
  expect(result.state.session.messages).toEqual([retryingState.session.messages[2]])
  expect(result.state.session.isProcessing).toBe(false)
})

it('removes retry statuses when retry recovery ends in an error', () => {
  const result = handleError(retryingState, { type: 'error', sessionId: 's', error: 'Retry failed' })
  expect(result.state.session.messages.filter(message => message.role === 'status')).toEqual([])
  expect(result.state.session.messages.at(-1)?.role).toBe('error')
})
