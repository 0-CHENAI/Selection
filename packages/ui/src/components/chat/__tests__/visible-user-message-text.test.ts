import { describe, expect, it } from 'bun:test'
import type { ContentBadge } from '@craft-agent/core'
import { INTERRUPTION_SYSTEM_REMINDER } from '@craft-agent/shared/agent/user-message-sanitize'
import { getUserMessageCopyText, getVisibleUserMessageSource } from '../visible-user-message-text'

function badge(partial: Partial<ContentBadge> & Pick<ContentBadge, 'type' | 'start' | 'end'>): ContentBadge {
  return {
    label: partial.label ?? '',
    rawText: partial.rawText ?? '',
    ...partial,
  }
}

describe('visible user message copy text (#372)', () => {
  it('strips markdown to the same plain text as assistant copy', () => {
    expect(getUserMessageCopyText('## Hello **world**')).toBe('Hello world')
  })

  it('omits context-badge hidden ranges and edit_request fragments', () => {
    const content = 'keep visible\n<edit_request>secret</edit_request>\nmore'
    const badges = [
      badge({
        type: 'context',
        start: content.indexOf('<edit_request>'),
        end: content.indexOf('</edit_request>') + '</edit_request>'.length,
        rawText: '<edit_request>secret</edit_request>',
        collapsedLabel: 'Edit: Permissions',
        label: 'Edit',
      }),
    ]
    expect(getVisibleUserMessageSource(content, badges)).toBe('keep visible\n\nmore')
    expect(getUserMessageCopyText(content, badges)).toBe('keep visible\n\nmore')
    expect(getUserMessageCopyText(content, badges)).not.toContain('secret')
    expect(getUserMessageCopyText(content, badges)).not.toContain('Edit: Permissions')
  })

  it('keeps source and file mentions that remain visible in the bubble', () => {
    const content = 'Ask @linear about plans/foo.md'
    const badges = [
      badge({ type: 'source', start: 4, end: 11, label: 'Linear', rawText: '@linear' }),
      badge({ type: 'file', start: 18, end: 30, label: 'foo.md', rawText: 'plans/foo.md', filePath: 'plans/foo.md' }),
    ]
    expect(getUserMessageCopyText(content, badges)).toBe('Ask @linear about plans/foo.md')
  })

  it('strips model-only reminder artifacts and treats leftover whitespace as empty', () => {
    expect(getUserMessageCopyText(`${INTERRUPTION_SYSTEM_REMINDER}\n`)).toBe('')
    expect(getUserMessageCopyText('   \n')).toBe('')
  })

  it('does not append attachment paths', () => {
    expect(getUserMessageCopyText('just text')).toBe('just text')
  })
})
