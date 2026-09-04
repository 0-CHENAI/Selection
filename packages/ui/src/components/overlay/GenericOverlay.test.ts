import { describe, expect, it } from 'bun:test'
import { shouldRenderGenericOverlayContent } from './GenericOverlay'

describe('GenericOverlay error content deduplication (#222)', () => {
  it('renders one error location when tool content repeats the error banner', () => {
    const failure = 'spawn_session failed: missing qualification contract'
    expect(shouldRenderGenericOverlayContent(failure, failure)).toBe(false)
    expect(shouldRenderGenericOverlayContent(`  ${failure}\n`, failure)).toBe(false)
  })

  it('keeps distinct diagnostic output and successful content', () => {
    expect(shouldRenderGenericOverlayContent('partial output', 'tool failed')).toBe(true)
    expect(shouldRenderGenericOverlayContent('completed output')).toBe(true)
  })
})
