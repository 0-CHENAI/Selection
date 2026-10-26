import { expect, test } from 'bun:test'
import { pptFoldExpanded, pptResultMessageId, prunePptFolds, rememberPptFold, type PptFoldMap } from './ppt-result-fold'

test('fold state is per message and missing state stays collapsed', () => {
  const messages = [
    { id: 'user-1', clientMessageId: 'client-1', role: 'user' },
    { id: 'assistant-1', role: 'assistant' },
    { id: 'queued', role: 'user', isQueued: true },
  ]
  expect(pptResultMessageId(messages)).toBe('client-1')
  expect(pptResultMessageId([{ id: 'user-2', role: 'user' }, ...messages])).toBe('client-1')
  expect(pptFoldExpanded({}, 'session-a', 'client-1')).toBe(false)

  const expanded = rememberPptFold({}, 'session-a', 'client-1', true, 10)
  expect(pptFoldExpanded(expanded, 'session-a', 'client-1')).toBe(true)
  expect(pptFoldExpanded(expanded, 'session-a', 'client-2')).toBe(false)
  expect(pptFoldExpanded(expanded, 'session-b', 'client-1')).toBe(false)

  const both = rememberPptFold(expanded, 'session-a', 'client-2', true, 20)
  expect(both['session-a']?.messages).toEqual(['client-1', 'client-2'])
  const collapsed = rememberPptFold(both, 'session-a', 'client-1', false, 30)
  expect(pptFoldExpanded(collapsed, 'session-a', 'client-1')).toBe(false)
  expect(pptFoldExpanded(collapsed, 'session-a', 'client-2')).toBe(true)
  expect(rememberPptFold(collapsed, 'session-a', 'client-2', false, 40)).toEqual({})
})

test('fold memory keeps the newest sessions', () => {
  let map: PptFoldMap = {}
  for (let index = 0; index < 101; index++) map = rememberPptFold(map, `session-${index}`, 'message', true, index)
  const pruned = prunePptFolds(map)
  expect(Object.keys(pruned)).toHaveLength(100)
  expect(pruned['session-0']).toBeUndefined()
  expect(pptFoldExpanded(pruned, 'session-100', 'message')).toBe(true)
})
