import { describe, expect, it } from 'bun:test'
import { answerExecutionError } from './answer-delivery-guard'

describe('SDK answer delivery boundary', () => {
  const normal = { runId: 'run', accepted: false, recovery: false, batchSize: 1 }
  it('rejects an answer in a parallel batch, without blocking its business tools', () => {
    const batch = { ...normal, batchSize: 2 }
    expect(answerExecutionError(batch, 'mcp__session__submit_answer')).toContain('alone')
    expect(answerExecutionError(batch, 'Bash')).toBeUndefined()
  })
  it('accepts the answer after sibling business tools in that batch have settled (#361)', () => {
    expect(answerExecutionError({ ...normal, batchSize: 2, siblingsSettled: true, answerCalls: 1 }, 'submit_answer')).toBeUndefined()
    expect(answerExecutionError({ ...normal, batchSize: 2, siblingsSettled: true, answerCalls: 1 }, 'mcp__session__submit_answer')).toBeUndefined()
  })
  it('rejects duplicate answer calls in the same batch', () => {
    expect(answerExecutionError({ ...normal, batchSize: 2 }, 'submit_answer')).toContain('alone')
    expect(answerExecutionError({ ...normal, batchSize: 3, siblingsSettled: true, answerCalls: 2 }, 'submit_answer')).toContain('alone')
  })
  it('allows a standalone answer, but not in a session without the protocol', () => {
    expect(answerExecutionError(normal, 'submit_answer')).toBeUndefined()
    expect(answerExecutionError({ ...normal, runId: undefined }, 'submit_answer')).toContain('alone')
  })
  it('blocks native, proxy and answer tools after acceptance', () => {
    for (const name of ['Bash', 'Write', 'mcp__source__search', 'submit_answer']) {
      expect(answerExecutionError({ ...normal, accepted: true }, name)).toContain('already delivered')
    }
  })
  it('permits only the answer tool during recovery', () => {
    expect(answerExecutionError({ ...normal, recovery: true }, 'Read')).toContain('Only submit_answer')
    expect(answerExecutionError({ ...normal, recovery: true }, 'submit_answer')).toBeUndefined()
  })
})
