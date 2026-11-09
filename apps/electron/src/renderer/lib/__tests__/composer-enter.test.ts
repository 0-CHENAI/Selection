import { describe, expect, it } from 'bun:test'
import { initialComposerEnterState, reduceComposerEnter } from '../composer-enter'

describe('composer enter', () => {
  it('does not animate history when a session finishes loading', () => {
    const loading = reduceComposerEnter(initialComposerEnterState(), {
      sessionId: 's1',
      messagesLoading: true,
      userIds: [],
    })
    const ready = reduceComposerEnter(loading, {
      sessionId: 's1',
      messagesLoading: false,
      userIds: ['old'],
    })
    expect(ready.enteringIds).toEqual([])
    expect(ready.seenIds).toEqual(['old'])
  })

  it('animates a user message added after the transcript is ready', () => {
    const ready = reduceComposerEnter(initialComposerEnterState(), {
      sessionId: 's1',
      messagesLoading: false,
      userIds: [],
    })
    const sent = reduceComposerEnter(ready, {
      sessionId: 's1',
      messagesLoading: false,
      userIds: ['new'],
    })
    expect(sent.enteringIds).toEqual(['new'])
  })

  it('does not animate when switching sessions', () => {
    const ready = reduceComposerEnter(initialComposerEnterState(), {
      sessionId: 's1',
      messagesLoading: false,
      userIds: ['a'],
    })
    const switched = reduceComposerEnter(ready, {
      sessionId: 's2',
      messagesLoading: false,
      userIds: ['b'],
    })
    expect(switched.enteringIds).toEqual([])
    expect(switched.seenIds).toEqual(['b'])
  })
})
