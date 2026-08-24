import { describe, expect, it } from 'bun:test'
import { appendRestoredInput, coerceInputText, getRestorableStoppedPrompt, sessionHasLiveGeneration } from '../input-text'

describe('coerceInputText', () => {
  it('preserves plain strings', () => {
    expect(coerceInputText('hello')).toBe('hello')
  })

  it('treats nullish values as empty text', () => {
    expect(coerceInputText(undefined)).toBe('')
    expect(coerceInputText(null)).toBe('')
  })

  it('extracts text from draft-like objects', () => {
    expect(coerceInputText({ text: 'draft text', attachments: [] })).toBe('draft text')
  })

  it('drops malformed object values instead of returning [object Object]', () => {
    expect(coerceInputText({ text: { nested: true } })).toBe('')
    expect(coerceInputText({ value: 'not a supported shape' })).toBe('')
  })

  it('stringifies primitive scalar values', () => {
    expect(coerceInputText(42)).toBe('42')
    expect(coerceInputText(false)).toBe('false')
  })
})

describe('appendRestoredInput', () => {
  it('returns the restored text when there is no existing draft', () => {
    expect(appendRestoredInput('', 'hello')).toBe('hello')
    expect(appendRestoredInput(undefined, 'hello')).toBe('hello')
  })

  it('appends restored text below an existing draft with a blank line', () => {
    expect(appendRestoredInput('draft', 'restored')).toBe('draft\n\nrestored')
  })

  it('returns the existing draft unchanged when there is nothing to restore', () => {
    expect(appendRestoredInput('draft', '')).toBe('draft')
    expect(appendRestoredInput('draft', undefined)).toBe('draft')
  })

  it('returns empty string when both sides are empty', () => {
    expect(appendRestoredInput('', '')).toBe('')
    expect(appendRestoredInput(undefined, undefined)).toBe('')
  })

  it('coerces malformed (non-string) persisted draft values defensively', () => {
    expect(appendRestoredInput({ text: 'draft' } as unknown as string, 'msg')).toBe('draft\n\nmsg')
  })
})

describe('getRestorableStoppedPrompt', () => {
  it('returns the latest visible prompt from the active user turn', () => {
    expect(getRestorableStoppedPrompt([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'latest' },
    ])).toBe('latest')
  })

  it('does not restore an older prompt when the active turn is a hidden continuation', () => {
    expect(getRestorableStoppedPrompt([
      { role: 'user', content: 'already submitted' },
      { role: 'user', content: 'internal retry', hidden: true },
    ])).toBe('')
  })

  it('ignores queued composer messages because the backend restores them', () => {
    expect(getRestorableStoppedPrompt([
      { role: 'user', content: 'active prompt' },
      { role: 'user', content: 'queued draft', isQueued: true },
    ])).toBe('active prompt')
  })
})

describe('sessionHasLiveGeneration', () => {
  it('treats isProcessing as live generation', () => {
    expect(sessionHasLiveGeneration({ isProcessing: true, messages: [] })).toBe(true)
  })

  it('treats a streaming assistant body as live even if isProcessing is stale', () => {
    expect(sessionHasLiveGeneration({
      isProcessing: false,
      messages: [{ role: 'assistant', isStreaming: true, isPending: true }],
    })).toBe(true)
  })

  it('does not treat idle transcript messages as live generation', () => {
    expect(sessionHasLiveGeneration({
      isProcessing: false,
      messages: [{ role: 'user', content: 'done' }, { role: 'assistant', content: 'reply' }],
    })).toBe(false)
  })

  it('does not treat settled work-chain commentary as live after the turn stops', () => {
    expect(sessionHasLiveGeneration({
      isProcessing: false,
      messages: [
        { role: 'assistant', content: 'PAGE field is properly structured', isIntermediate: true },
        { role: 'assistant', content: '已写好公式和模拟过程' },
      ],
    })).toBe(false)
  })

  it('treats pending commentary as live when isProcessing is stale', () => {
    expect(sessionHasLiveGeneration({
      isProcessing: false,
      messages: [{ role: 'assistant', content: '先读目录', isIntermediate: true, isPending: true }],
    })).toBe(true)
  })

  it('treats a thinking status pill as live when isProcessing is stale', () => {
    expect(sessionHasLiveGeneration({
      isProcessing: false,
      currentStatus: { message: 'Thinking…' },
      messages: [{ role: 'user', content: 'question' }],
    })).toBe(true)
  })

  it('treats a work-chain-only executing tool as live when isProcessing is stale', () => {
    expect(sessionHasLiveGeneration({
      isProcessing: false,
      messages: [
        { role: 'user', content: 'read the doc' },
        { role: 'tool', toolStatus: 'executing', content: '' },
      ],
    })).toBe(true)
  })

  it('does not treat a finished background task as live generation', () => {
    expect(sessionHasLiveGeneration({
      isProcessing: false,
      messages: [
        { role: 'assistant', content: 'done' },
        { role: 'tool', toolStatus: 'executing', isBackground: true, taskId: 'task-1' },
      ],
    })).toBe(false)
  })
})
