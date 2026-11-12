import { describe, expect, test } from 'bun:test'
import { revealStreamingText, STREAM_PACE_MAX_LAG_MS } from '../stream-pace'

describe('revealStreamingText', () => {
  test('flushes immediately when the stream ends or the prefix breaks', () => {
    expect(revealStreamingText('ab', 'abcd', 16, false)).toBe('abcd')
    expect(revealStreamingText('ab', 'xy', 16, true)).toBe('xy')
  })

  test('leaks a burst across a few frames instead of painting it whole', () => {
    let shown = 'hello'
    const incoming = 'hello, this is a burst of tokens'
    shown = revealStreamingText(shown, incoming, 16, true)
    expect(shown.length).toBeGreaterThan('hello'.length)
    expect(shown.length).toBeLessThan(incoming.length)
    expect(incoming.startsWith(shown)).toBe(true)
  })

  test('does not park a burst behind a typewriter, and flushes when the stream ends', () => {
    const incoming = 'x'.repeat(400)
    let shown = ''
    for (let i = 0; i < Math.ceil(STREAM_PACE_MAX_LAG_MS / 16); i++) {
      shown = revealStreamingText(shown, incoming, 16, true)
    }
    expect(shown.length).toBeGreaterThan(incoming.length * 0.6)
    expect(revealStreamingText(shown, incoming, 16, false)).toBe(incoming)
  })
})
