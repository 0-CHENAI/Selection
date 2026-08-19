import { describe, expect, it } from 'bun:test'
import { applySteerTranscriptBoundary } from '../steer-transcript.ts'

describe('applySteerTranscriptBoundary', () => {
  it('hides the response body and moves thought under the follow-up', () => {
    const next = applySteerTranscriptBoundary([
      { id: 'user', role: 'user', content: '查看结构', timestamp: 1 },
      { id: 'thought', role: 'assistant', content: '先读', timestamp: 2, isIntermediate: true },
      { id: 'answer', role: 'assistant', content: 'partial', timestamp: 3, isStreaming: true, isPending: true, turnId: 'live' },
      { id: 'follow-up', role: 'user', content: '再说摘要', timestamp: 4, isQueued: true, queueId: 'follow-up' },
    ], new Set(['follow-up']), () => 10)

    expect(next.find(message => message.id === 'answer')?.hidden).toBe(true)
    const followUp = next.find(message => message.id === 'follow-up')
    const thought = next.find(message => message.id === 'thought')
    expect(followUp).toMatchObject({ isQueued: false, hidden: false })
    expect(thought).toMatchObject({ hidden: false, isIntermediate: true })
    expect(thought?.timestamp).toBeGreaterThan(followUp?.timestamp ?? 0)
  })
})
