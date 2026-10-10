import { expect, it } from 'bun:test'
import { handleStatus } from '../session'
import type { SessionState } from '../../types'

it('clears a recovered retry status without an empty activity or stopping active work', () => {
  const state = { session: { id: 's', workspaceId: 'ws', workspaceName: 'Workspace',
    lastMessageAt: 0, isProcessing: true, messages: [], currentStatus: { message: 'Retrying (attempt 1/3)...' } },
    streaming: null } satisfies SessionState
  const result = handleStatus(state, { type: 'status', sessionId: 's', message: '' })
  expect(result.state.session.currentStatus).toBeUndefined()
  expect(result.state.session.messages).toEqual([])
  expect(result.state.session.isProcessing).toBe(true)
});
