import { expect, it } from 'bun:test'
import { parseTokenCount, formatTokenInput } from '../token-count-input'

it('accepts exact counts and case-insensitive K/M suffixes', () => {
  expect(parseTokenCount('500K')).toBe(512000)
  expect(parseTokenCount('128k')).toBe(131072)
  expect(parseTokenCount(' 128 K ')).toBe(131072)
  expect(parseTokenCount('1.5m')).toBe(1572864)
  expect(parseTokenCount('123456')).toBe(123456)
  expect(formatTokenInput(131072)).toBe('128K')
  expect(parseTokenCount(formatTokenInput(123456))).toBe(123456)
})
it('rejects invalid, fractional token counts and unsafe values', () => {
  for (const value of ['', '0', '-128K', '128KB', '1e5', '1.1', '0.1K', 'Infinity', '9007199254740992']) {
    expect(parseTokenCount(value)).toBeUndefined()
  }
})
