import { expect, test } from 'bun:test'
import { isUnreadableTerminalText, readableAnsiForeground } from './ansi-parser'

test('dark ANSI black stays readable unless a contrasting background is set', () => {
  expect(readableAnsiForeground('#1a1a1a', undefined, 'dark')).toBe('#e4e4e4')
  expect(readableAnsiForeground('#1a1a1a', '#ffffff', 'dark')).toBe('#1a1a1a')
  expect(readableAnsiForeground('#e4e4e4', undefined, 'light')).toBe('#1a1a1a')
  expect(readableAnsiForeground('#e4e4e4', '#1a1a1a', 'light')).toBe('#e4e4e4')
  expect(readableAnsiForeground('#22c55e', undefined, 'dark')).toBe('#22c55e')
  expect(readableAnsiForeground(undefined, undefined, 'dark')).toBeUndefined()
})

test('binary terminal dumps are omitted and ordinary logs are kept', () => {
  expect(isUnreadableTerminalText('build finished\npage 2 ok')).toBe(false)
  expect(isUnreadableTerminalText('\u001b[30mstill a sentence')).toBe(false)
  const png = `\u0089PNG\r\n\u0000\u0001\u0002\u0003\u0004\u0005${'\uFFFD'.repeat(20)}`
  expect(isUnreadableTerminalText(png)).toBe(true)
})
