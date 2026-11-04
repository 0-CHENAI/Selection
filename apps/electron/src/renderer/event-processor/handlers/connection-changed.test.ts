import { describe, expect, it } from 'bun:test'
import { handleConnectionChanged } from './session'
import type { SessionState } from '../types'

describe('connection change events', () => {
  const state = {
    session: { id: 'session', llmConnection: 'old', model: 'old-model' },
    streaming: null,
  } as SessionState

  it('updates the provider and selected model together', () => {
    const result = handleConnectionChanged(state, {
      type: 'connection_changed', sessionId: 'session', connectionSlug: 'eming', model: 'gpt-6.1-terra',
    })
    expect(result.state.session).toMatchObject({ llmConnection: 'eming', model: 'gpt-6.1-terra' })
  })

  it('preserves the model for legacy events and clears it for an explicit null', () => {
    const event = { type: 'connection_changed' as const, sessionId: 'session', connectionSlug: 'new' }
    expect(handleConnectionChanged(state, event).state.session.model).toBe('old-model')
    expect(handleConnectionChanged(state, { ...event, model: null }).state.session.model).toBeUndefined()
  })
})
