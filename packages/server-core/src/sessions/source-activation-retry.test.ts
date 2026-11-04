import { describe, expect, it } from 'bun:test'
import { resolveSourceActivationRetry, sourceActivationRetryMessage } from './source-activation-retry.ts'

describe('resolveSourceActivationRetry', () => {
  it('skips when there is no text and no attachments', () => {
    expect(resolveSourceActivationRetry({ originalMessage: '' })).toBeNull()
    expect(resolveSourceActivationRetry({ originalMessage: '   ' })).toBeNull()
  })

  it('keeps a non-empty original message', () => {
    expect(resolveSourceActivationRetry({ originalMessage: 'list repos' })).toEqual({
      text: 'list repos',
    })
  })

  it('does not re-attach images when the original message had text', () => {
    expect(resolveSourceActivationRetry({
      originalMessage: 'look at this',
      attachments: [{ name: 'photo.jpg', type: 'image' }],
    })).toEqual({ text: 'look at this' })
  })

  it('falls back to the last user message when the activation payload is empty', () => {
    expect(resolveSourceActivationRetry({
      originalMessage: '',
      lastUserMessage: 'look at this',
    })).toEqual({ text: 'look at this' })
  })

  it('retries attachment-only turns with attachments and no user text', () => {
    const attachments = [{ name: 'photo.jpg', type: 'image' }]
    expect(resolveSourceActivationRetry({
      originalMessage: '',
      attachments,
    })).toEqual({ text: '', attachments })
    expect(sourceActivationRetryMessage('', 'github')).toBe('[github activated]')
  })
})
