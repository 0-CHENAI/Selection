import { describe, expect, it, test } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { getAssistantTurnUiKey, groupMessagesByTurn, type AssistantTurn } from '../turn-utils'

function makeAssistantTurn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  return {
    type: 'assistant',
    turnId: 'pi-turn-1',
    activities: [],
    response: undefined,
    intent: undefined,
    isStreaming: false,
    isComplete: true,
    timestamp: 123,
    ...overrides,
  }
}

describe('getAssistantTurnUiKey', () => {
  it('stays stable when a response message id appears or disappears mid-stream', () => {
    const withoutResponse = makeAssistantTurn({ isStreaming: true, isComplete: false })
    const withResponse = makeAssistantTurn({
      isStreaming: true,
      isComplete: false,
      response: {
        text: '先搜索这三个模型。',
        isStreaming: true,
        messageId: 'msg-pending-1',
      },
    })
    const afterDemote = makeAssistantTurn({ isStreaming: true, isComplete: false })

    const key = getAssistantTurnUiKey(withoutResponse, 4)
    expect(getAssistantTurnUiKey({ ...withResponse, timestamp: 999 }, 4)).toBe(key)
    expect(getAssistantTurnUiKey(withResponse, 4)).toBe(key)
    expect(getAssistantTurnUiKey(afterDemote, 4)).toBe(key)
    expect(key).toBe('assistant:turn:pi-turn-1:4')
  })

  it('disambiguates split cards with same turnId/timestamp via index fallback', () => {
    const turnA = makeAssistantTurn({ turnId: 'pi-turn-1', timestamp: 555 })
    const turnB = makeAssistantTurn({ turnId: 'pi-turn-1', timestamp: 555 })

    const keyA = getAssistantTurnUiKey(turnA, 2)
    const keyB = getAssistantTurnUiKey(turnB, 3)

    expect(keyA).not.toBe(keyB)
    expect(keyA).toBe('assistant:turn:pi-turn-1:2')
    expect(keyB).toBe('assistant:turn:pi-turn-1:3')
  })
})

function expansionIdentity(messages: Message[]) {
  const turns = groupMessagesByTurn(messages)
  const index = turns.findIndex(turn => turn.type === 'assistant')
  const turn = turns[index]
  if (!turn || turn.type !== 'assistant') {
    throw new Error('expected an assistant turn')
  }
  return {
    index,
    timestamp: turn.timestamp,
    key: getAssistantTurnUiKey(turn, index),
    messageId: turn.response?.messageId,
    activityIds: turn.activities.map(activity => activity.id),
  }
}

function userMessage(): Message {
  return { id: 'user-1', role: 'user', content: '调研这三个模型', timestamp: 1000 }
}

function toolMessage(
  id: string,
  timestamp: number,
  status: 'running' | 'completed',
  name = 'web_search',
): Message {
  return {
    id,
    role: 'tool',
    content: status === 'completed' ? 'ok' : '',
    timestamp,
    toolName: name,
    toolUseId: `tu-${id}`,
    toolStatus: status === 'completed' ? 'completed' : undefined,
    toolResult: status === 'completed' ? 'ok' : undefined,
    turnId: 'pi-turn-1',
  }
}

function pendingAssistant(id: string, timestamp: number, content: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    isStreaming: true,
    isPending: true,
    turnId: 'pi-turn-1',
  }
}

function intermediateAssistant(id: string, timestamp: number, content: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    isStreaming: false,
    isPending: false,
    isIntermediate: true,
    turnId: 'pi-turn-1',
  }
}

function finalAssistant(id: string, timestamp: number, content: string, streaming: boolean): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    isStreaming: streaming,
    isPending: streaming,
    turnId: 'pi-turn-1',
  }
}

describe('assistant expansion key through a live generation', () => {
  it('stays on the same card while tools, pending text, and the final reply arrive', () => {
    let messages: Message[] = [
      userMessage(),
      toolMessage('tool-1', 1100, 'running'),
    ]

    const first = expansionIdentity(messages)
    expect(first.index).toBe(1)
    expect(first.messageId).toBeUndefined()
    expect(first.activityIds).toEqual(['tool-1'])

    messages = [
      userMessage(),
      toolMessage('tool-1', 1100, 'completed'),
    ]
    expect(expansionIdentity(messages).key).toBe(first.key)

    messages = [
      userMessage(),
      toolMessage('tool-1', 1100, 'completed'),
      pendingAssistant('msg-pending-1', 1200, '先搜索这三个模型。'),
    ]
    const withPending = expansionIdentity(messages)
    expect(withPending.messageId).toBe('msg-pending-1')
    expect(withPending.key).toBe(first.key)
    expect(withPending.timestamp).toBe(first.timestamp)
    expect(withPending.index).toBe(1)

    messages = [
      userMessage(),
      toolMessage('tool-1', 1100, 'completed'),
      intermediateAssistant('msg-pending-1', 1200, '先搜索这三个模型。'),
    ]
    const afterDemote = expansionIdentity(messages)
    expect(afterDemote.messageId).toBeUndefined()
    expect(afterDemote.activityIds).toContain('msg-pending-1')
    expect(afterDemote.key).toBe(first.key)

    messages = [
      userMessage(),
      toolMessage('tool-1', 1100, 'completed'),
      intermediateAssistant('msg-pending-1', 1200, '先搜索这三个模型。'),
      toolMessage('tool-2', 1300, 'running', 'read'),
    ]
    expect(expansionIdentity(messages).key).toBe(first.key)

    messages = [
      userMessage(),
      toolMessage('tool-1', 1100, 'completed'),
      intermediateAssistant('msg-pending-1', 1200, '先搜索这三个模型。'),
      toolMessage('tool-2', 1300, 'completed', 'read'),
      finalAssistant('msg-final', 1400, '三个模型的对比如下。', true),
    ]
    const streamingFinal = expansionIdentity(messages)
    expect(streamingFinal.messageId).toBe('msg-final')
    expect(streamingFinal.key).toBe(first.key)

    messages = [
      userMessage(),
      toolMessage('tool-1', 1100, 'completed'),
      intermediateAssistant('msg-pending-1', 1200, '先搜索这三个模型。'),
      toolMessage('tool-2', 1300, 'completed', 'read'),
      finalAssistant('msg-final', 1400, '三个模型的对比如下。', false),
    ]
    const complete = expansionIdentity(messages)
    expect(complete.messageId).toBe('msg-final')
    expect(complete.key).toBe(first.key)
    expect(complete.index).toBe(1)
  })
})

describe('whitespace-only leading thought (pi backend)', () => {
  const thoughtTurnId = 'pi-turn-1_thought'
  const pendingThought: Message = {
    id: 'thought-1', role: 'assistant', content: ' ', timestamp: 1050,
    isStreaming: true, isPending: true, isIntermediate: true, phase: 'intermediate', turnId: thoughtTurnId,
  }
  const completedThought: Message = { ...pendingThought, isStreaming: false, isPending: false }

  it('keeps one card key from the pending thought through its completion and the first tool', () => {
    const live = (messages: Message[]) => {
      const turns = groupMessagesByTurn(messages, { isSessionProcessing: true })
      const index = turns.findIndex(turn => turn.type === 'assistant')
      const turn = turns[index]
      if (!turn || turn.type !== 'assistant') throw new Error('expected an assistant turn')
      return { turn, key: getAssistantTurnUiKey(turn, index) }
    }

    const pending = live([userMessage(), pendingThought])
    expect(pending.turn.activities.map(a => a.type)).toEqual(['intermediate'])

    // The thought completed but no tool has arrived: the turn (and its key) must survive the gap.
    const gap = live([userMessage(), completedThought])
    expect(gap.key).toBe(pending.key)
    expect(gap.turn.activities).toEqual([])
    expect(gap.turn.isComplete).toBe(false)

    const withTool = live([userMessage(), completedThought, toolMessage('tool-1', 1100, 'running')])
    expect(withTool.key).toBe(pending.key)
    expect(withTool.turn.activities.map(a => a.id)).toEqual(['tool-1'])
  })

  it('drops an empty anchored turn once the session is no longer processing', () => {
    const turns = groupMessagesByTurn([userMessage(), completedThought], { isSessionProcessing: false })
    expect(turns.map(turn => turn.type)).toEqual(['user'])
    const historical = groupMessagesByTurn([
      userMessage(), completedThought,
      { ...userMessage(), id: 'user-2', timestamp: 1200 },
      finalAssistant('answer-2', 1300, '第二段回答', false),
    ])
    expect(historical.map(turn => turn.type)).toEqual(['user', 'user', 'assistant'])
  })

  it('does not reopen a finished turn for a stray empty thought', () => {
    const turns = groupMessagesByTurn([
      userMessage(),
      finalAssistant('answer-1', 1100, '第一段回答', false),
      { ...completedThought, timestamp: 1150 },
    ], { isSessionProcessing: true })
    const assistant = turns.filter(turn => turn.type === 'assistant')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]?.type === 'assistant' && assistant[0].response?.text).toBe('第一段回答')
  })
})

test('reused provider turn IDs remain distinct across user interruption boundaries', () => {
  const turns = groupMessagesByTurn([
    userMessage(),
    finalAssistant('answer-1', 1100, '第一段回答', false),
    { ...userMessage(), id: 'user-2', timestamp: 1200 },
    finalAssistant('answer-2', 1300, '第二段回答', false),
  ])
  const keys = turns.flatMap((turn, index) => turn.type === 'assistant'
    ? [getAssistantTurnUiKey(turn, index)] : [])
  expect(keys).toHaveLength(2)
  expect(new Set(keys).size).toBe(2)
})
