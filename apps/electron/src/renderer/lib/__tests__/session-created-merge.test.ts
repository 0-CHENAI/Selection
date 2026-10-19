import { describe, expect, it } from 'bun:test'
import { mergeCreatedSessionMessages } from '../session-created-merge'

describe('mergeCreatedSessionMessages', () => {
  it('keeps an optimistic user message the server has not stored yet', () => {
    const merged = mergeCreatedSessionMessages(
      [{ id: 'optimistic', role: 'user', content: 'hello', isPending: true }],
      [],
    )
    expect(merged.map(message => message.id)).toEqual(['optimistic'])
  })

  it('does not duplicate a pending row once the server copy is present', () => {
    const merged = mergeCreatedSessionMessages(
      [{ id: 'optimistic', role: 'user', content: 'hello', isPending: true }],
      [{ id: 'server', role: 'user', content: 'hello' }],
    )
    expect(merged.map(message => message.id)).toEqual(['server'])
  })

  it('matches a row by clientMessageId', () => {
    const merged = mergeCreatedSessionMessages(
      [{ id: 'optimistic', clientMessageId: 'client-1', role: 'user', content: 'hello', isPending: true }],
      [{ id: 'server', clientMessageId: 'optimistic', role: 'user', content: 'hello' }],
    )
    expect(merged.map(message => message.id)).toEqual(['server'])
  })
})
