import { describe, expect, it } from 'bun:test'
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
    expect(getAssistantTurnUiKey(withResponse, 4)).toBe(key)
    expect(getAssistantTurnUiKey(afterDemote, 4)).toBe(key)
    expect(key).toBe('assistant:turn:pi-turn-1:123:4')
  })

  it('disambiguates split cards with same turnId/timestamp via index fallback', () => {
    const turnA = makeAssistantTurn({ turnId: 'pi-turn-1', timestamp: 555 })
    const turnB = makeAssistantTurn({ turnId: 'pi-turn-1', timestamp: 555 })

    const keyA = getAssistantTurnUiKey(turnA, 2)
    const keyB = getAssistantTurnUiKey(turnB, 3)

    expect(keyA).not.toBe(keyB)
    expect(keyA).toBe('assistant:turn:pi-turn-1:555:2')
    expect(keyB).toBe('assistant:turn:pi-turn-1:555:3')
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
