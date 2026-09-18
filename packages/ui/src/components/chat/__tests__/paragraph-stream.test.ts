import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { completedParagraphs, streamingResponseBody } from '../paragraph-stream'

it('只追加收到的完整段落，不挂载未完成的尾部', () => {
  expect(completedParagraphs('第一段', true)).toBe('')
  expect(completedParagraphs('第一段\n\n第二', true)).toBe('第一段\n\n')
  expect(completedParagraphs('第一段\n\n第二段\n\n第三', true)).toBe('第一段\n\n第二段\n\n')
  expect(completedParagraphs('第一段\n\n第二段', false)).toBe('第一段\n\n第二段')
})

it('代码块里的空行不会成为段落分界', () => {
  const prefix = '说明\n\n'
  const code = '```ts\nconst x = 1\n\n'
  expect(completedParagraphs(prefix + code, true)).toBe(prefix)
  expect(completedParagraphs(prefix + code + '```\n\n尾部', true)).toBe(prefix + code + '```\n\n')
})

it('列表和引用内部的空行不拆开同一块', () => {
  expect(completedParagraphs('介绍\n\n- 第一项\n\n- 第二项', true)).toBe('介绍\n\n')
  expect(completedParagraphs('介绍\n\n> 第一段\n>\n> 第二段\n\n', true)).toBe('介绍\n\n')
  expect(completedParagraphs('- 第一项\n\n- 第二项\n\n下一段', true)).toBe('- 第一项\n\n- 第二项\n\n')
})

it('keeps the white response frame mounted and does not tween its height', () => {
  const src = readFileSync(join(import.meta.dir, '../TurnCard.tsx'), 'utf8')
  const grow = src.slice(src.indexOf('function GrowingResponse'), src.indexOf('function ActivityRow'))
  expect(grow).not.toContain('animate={{ height')
  expect(src).not.toContain('hasVisibleResponse && !isBuffering')
  expect(src).not.toContain('if (isStreaming && !bodyText.trim())')
})

it('ordinary prose grows token by token; lists and fences stay held until complete', () => {
  expect(streamingResponseBody('第一段', true)).toBe('第一段')
  expect(streamingResponseBody('第一段\n\n第二', true)).toBe('第一段\n\n第二')
  expect(streamingResponseBody('介绍\n\n- 第一项', true)).toBe('介绍\n\n')
  expect(streamingResponseBody('说明\n\n```ts\nconst x = 1\n', true)).toBe('说明\n\n')
  expect(streamingResponseBody('第一段\n\n第二段', false)).toBe('第一段\n\n第二段')
})

it('reserves the desktop action row while the response is still streaming', () => {
  const src = readFileSync(join(import.meta.dir, '../TurnCard.tsx'), 'utf8')
  expect(src).toContain('reserveDesktopFooter')
  expect(src).toContain('!showCompletedChrome && "invisible pointer-events-none"')
})
