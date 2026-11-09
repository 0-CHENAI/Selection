import { describe, expect, it } from 'bun:test'
import { completionStopReason } from './completion-outcome.ts'

describe('completionStopReason', () => {
  it('treats a trailing visible error as failure', () => {
    expect(completionStopReason([
      { role: 'user' },
      { role: 'error' },
    ])).toBe('error')
  })

  it('treats a later assistant reply as success after an earlier error', () => {
    expect(completionStopReason([
      { role: 'user' },
      { role: 'error' },
      { role: 'assistant' },
    ])).toBe('complete')
  })

  it('skips hidden, queued, and intermediate messages', () => {
    expect(completionStopReason([
      { role: 'assistant' },
      { role: 'error', hidden: true },
      { role: 'error', isQueued: true },
      { role: 'error', isIntermediate: true },
    ])).toBe('complete')
  })

  it('defaults to success when nothing visible remains', () => {
    expect(completionStopReason([])).toBe('complete')
    expect(completionStopReason([{ role: 'error', hidden: true }])).toBe('complete')
  })

  it('does not inherit a previous turn error after a later user prompt', () => {
    expect(completionStopReason([
      { role: 'user' },
      { role: 'error' },
      { role: 'user' },
    ])).toBe('complete')
    expect(completionStopReason([
      { role: 'user' },
      { role: 'error' },
      { role: 'user' },
      { role: 'assistant' },
    ])).toBe('complete')
  })

  it('still fails when this turn ends on an error after the latest user prompt', () => {
    expect(completionStopReason([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'error' },
    ])).toBe('error')
  })
})
