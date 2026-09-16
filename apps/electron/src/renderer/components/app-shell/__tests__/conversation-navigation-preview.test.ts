import { describe, expect, it } from 'bun:test'
import type { ContentBadge } from '@craft-agent/core'
import { getConversationNavigationTitlePreview } from '../conversation-navigation-preview'

function badge(overrides: Partial<ContentBadge> = {}): ContentBadge {
  return {
    type: 'source',
    label: 'Source',
    rawText: '@source',
    start: 0,
    end: 7,
    ...overrides,
  }
}

describe('conversation navigation title preview', () => {
  it('keeps only the first line of a multi-line user message', () => {
    const preview = getConversationNavigationTitlePreview(
      'Please generate an architecture diagram. Requirements:\n\n1. Create a complete HTML file.\n2. Save it.',
      [],
    )

    expect(preview.content).toBe('Please generate an architecture diagram. Requirements:')
    expect(preview.badges).toEqual([])
  })

  it('handles Windows line endings', () => {
    const preview = getConversationNavigationTitlePreview('First line\r\nSecond line', [])

    expect(preview.content).toBe('First line')
  })

  it('keeps and clips badges on the first line while dropping later badges', () => {
    const preview = getConversationNavigationTitlePreview(
      '@source prepare report\n@later add appendix',
      [
        badge(),
        badge({ label: 'Cross-line', rawText: 'report\n@later', start: 16, end: 29 }),
        badge({ label: 'Later', rawText: '@later', start: 23, end: 29 }),
      ],
    )

    expect(preview.content).toBe('@source prepare report')
    expect(preview.badges).toEqual([
      badge(),
      badge({ label: 'Cross-line', rawText: 'report\n@later', start: 16, end: 22 }),
    ])
  })
})
