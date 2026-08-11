import { describe, it, expect } from 'bun:test'
import {
  stripSystemReminderBlocks,
  stripSourceActivationSuffix,
  sanitizeUserMessageForDisplay,
  sanitizeUserMessageForRetry,
  INTERRUPTION_SYSTEM_REMINDER,
} from '../user-message-sanitize.ts'

describe('user-message-sanitize', () => {
  it('strips system-reminder blocks', () => {
    const input = `阅读下知识库\n\n${INTERRUPTION_SYSTEM_REMINDER}`
    expect(stripSystemReminderBlocks(input)).toBe('阅读下知识库')
  })

  it('strips activation suffix', () => {
    expect(stripSourceActivationSuffix('hello\n\n[cortex activated]')).toBe('hello')
  })

  it('sanitizeUserMessageForDisplay removes both', () => {
    const input = `阅读下知识库中有没有范睿艺的论文\n\n${INTERRUPTION_SYSTEM_REMINDER}\n\n[cortex activated]`
    expect(sanitizeUserMessageForDisplay(input)).toBe('阅读下知识库中有没有范睿艺的论文')
  })

  it('leaves normal user text alone', () => {
    const msg = 'Please check [status] in the docs'
    expect(sanitizeUserMessageForDisplay(msg)).toBe(msg)
  })

  it('sanitizeUserMessageForRetry matches display sanitization', () => {
    const polluted = `msg\n\n${INTERRUPTION_SYSTEM_REMINDER}\n\n[foo activated]`
    expect(sanitizeUserMessageForRetry(polluted)).toBe('msg')
  })
})
