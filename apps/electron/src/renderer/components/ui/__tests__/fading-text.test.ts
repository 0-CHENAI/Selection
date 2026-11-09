import { describe, expect, it } from 'bun:test'

import { buildFadeMask, hasHorizontalOverflow } from '../fading-text'

describe('hasHorizontalOverflow', () => {
  it('keeps text unfaded when it fits', () => {
    expect(hasHorizontalOverflow({ clientWidth: 160, scrollWidth: 160 })).toBe(false)
  })

  it('enables the fade when text exceeds the available width', () => {
    expect(hasHorizontalOverflow({ clientWidth: 160, scrollWidth: 161 })).toBe(true)
    expect(hasHorizontalOverflow({ clientWidth: 160, scrollWidth: 280 })).toBe(true)
  })
})

describe('buildFadeMask', () => {
  it('preserves the existing edge fade when no trailing gap is requested', () => {
    expect(buildFadeMask(24, 0)).toBe(
      'linear-gradient(to right, black calc(100% - 24px), transparent)',
    )
  })

  it('finishes the fade before the reserved trailing gap', () => {
    expect(buildFadeMask(16, 12)).toBe(
      'linear-gradient(to right, black 0, black calc(100% - 28px), transparent calc(100% - 12px), transparent 100%)',
    )
  })
})
