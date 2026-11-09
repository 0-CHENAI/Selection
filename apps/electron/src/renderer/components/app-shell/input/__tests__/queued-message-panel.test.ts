import { describe, expect, it } from 'bun:test'
import type { Message } from '../../../../../shared/types'
import { queuedMessageCommandId, queuedMessageCommandIds } from '../QueuedMessagePanel'

function queued(id: string, queueId?: string, isPending = false): Message {
  return {
    id,
    queueId,
    role: 'user',
    content: id,
    timestamp: 1,
    isQueued: true,
    isPending,
  }
}

describe('queued message panel helpers', () => {
  it('uses the canonical backend id when the renderer kept an optimistic id', () => {
    expect(queuedMessageCommandId(queued('optimistic', 'canonical'))).toBe('canonical')
  })

  it('does not expose queue actions before a pending item is acknowledged', () => {
    expect(queuedMessageCommandId(queued('optimistic', undefined, true))).toBeNull()
  })

  it('maps the dropped visual order to canonical backend ids', () => {
    const messages = [queued('optimistic-b', 'b'), queued('optimistic-a', 'a')]

    expect(queuedMessageCommandIds(messages)).toEqual(['b', 'a'])
    expect(queuedMessageCommandIds([queued('pending', undefined, true)])).toBeNull()
  })
})
