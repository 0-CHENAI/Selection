import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyRevealBudget,
  computeAdaptiveQueueStep,
  countCodePoints,
  nextHeightFloor,
  nextRevealedText,
  QUEUE_MAX_SPEED_CPS,
  reconcileShown,
  sliceCodePoints,
} from '../stream-reveal'

it('releases one character from a small backlog and more as pressure grows', () => {
  expect(computeAdaptiveQueueStep(8, 16.67, 0).revealChars).toBe(1)
  expect(computeAdaptiveQueueStep(32, 16.67, 0).revealChars).toBe(2)
  expect(computeAdaptiveQueueStep(128, 16.67, 0).revealChars).toBe(7)
  const burst = computeAdaptiveQueueStep(512, 16.67, 0)
  expect(burst.speedCps).toBe(QUEUE_MAX_SPEED_CPS)
  expect(burst.revealChars).toBe(10)
})

it('carries fractional debt so a slow stream still advances', () => {
  const first = computeAdaptiveQueueStep(2, 8, 0)
  expect(first.revealChars).toBe(0)
  expect(first.debt).toBeGreaterThan(0)
  const second = computeAdaptiveQueueStep(2, 8, first.debt)
  expect(second.revealChars).toBeGreaterThanOrEqual(1)
})

it('does not dump the missed interval after a hitch', () => {
  const hitch = computeAdaptiveQueueStep(200, 250, 0)
  const frame = computeAdaptiveQueueStep(200, 32, 0)
  expect(hitch.revealChars).toBe(frame.revealChars)
})

it('slices by code point so CJK and emoji stay intact', () => {
  expect(countCodePoints('你好🙂')).toBe(3)
  expect(sliceCodePoints('你好🙂世界', 3)).toBe('你好🙂')
  expect(nextRevealedText('你', '你好世界', 2)).toBe('你好世')
  expect(nextRevealedText('旧', '新内容', 2)).toBe('新内容')
})

it('holds the response card height so a paced clip cannot shrink the white frame', () => {
  expect(nextHeightFloor(0, 48)).toBe(48)
  expect(nextHeightFloor(48, 64)).toBe(64)
  expect(nextHeightFloor(64, 40)).toBe(64)
})

it('keeps a readable prefix when React remounts text nodes', () => {
  expect(applyRevealBudget(['你好', '世界'], 3)).toEqual(['你好', '世'])
  expect(reconcileShown('你好', '你好世界', 2)).toBe(2)
  expect(reconcileShown('你好世', '你好世界', 3)).toBe(3)
  expect(reconcileShown('旧内容', '新内容', 3)).toBe(0)
})

it('does not drip characters through React Markdown state', () => {
  const card = readFileSync(join(import.meta.dir, '../TurnCard.tsx'), 'utf8')
  const markdown = readFileSync(join(import.meta.dir, '../../markdown/Markdown.tsx'), 'utf8')
  expect(card).toContain('useFrameSource')
  expect(card).not.toContain('usePacedReveal')
  expect(card).not.toContain('CONTENT_THROTTLE_MS')
  expect(markdown).toContain('useProgressiveDomText')
})
