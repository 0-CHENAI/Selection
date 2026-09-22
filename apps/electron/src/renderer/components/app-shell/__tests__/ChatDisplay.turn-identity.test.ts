import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getAssistantTurnUiKey } from '../../../../../../../packages/ui/src/components/chat/turn-utils'

test('completion metadata cannot remount a live assistant card', () => {
  const source = readFileSync(new URL('../ChatDisplay.tsx', import.meta.url), 'utf8')
  const body = source.match(/function getTurnKey\(turn: Turn, index: number\): string \{([\s\S]*?)\n\}/)?.[1]
  expect(body).toBeDefined()
  const evaluate = new Function('turn', 'index', 'getAssistantTurnUiKey', body!)
  const key = (turn: unknown, index = 1) => evaluate(turn, index, getAssistantTurnUiKey)
  const live = { type: 'assistant', turnId: 'sdk-subturn-2', timestamp: 100, response: { messageId: 'temporary', isStreaming: true } }
  const done = { ...live, timestamp: 200, response: { messageId: 'persisted', isStreaming: false } }
  expect(key(live)).toBe(key(done))
  expect(key(live, 1)).not.toBe(key(live, 3))
  expect(key({ ...live, turnId: 'next-turn' })).not.toBe(key(live))
})
