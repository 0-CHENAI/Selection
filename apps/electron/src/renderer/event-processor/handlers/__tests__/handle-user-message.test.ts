import { describe, expect, it } from 'bun:test'
import { groupMessagesByTurn } from '@craft-agent/ui/chat/turn-utils'
import { handleTextComplete, handleTextDelta } from '../text'
import { handleToolStart } from '../tool'
import { handleQueueChanged, handleUserMessage } from '../session'
import type { QueueChangedEvent, SessionState, UserMessageEvent } from '../../types'

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: 0,
      isProcessing: true,
    } as any,
    streaming: null,
  }
}

function processingEvent(timestamp: number): UserMessageEvent {
  return {
    type: 'user_message',
    sessionId: 'session-1',
    message: {
      id: 'backend-follow-up',
      role: 'user',
      content: 'follow up',
      timestamp,
    },
    status: 'processing',
    optimisticMessageId: 'optimistic-follow-up',
  }
}

describe('handleUserMessage queued replay', () => {
  it('applies the canonical replay timestamp without replacing the optimistic id', () => {
    const state = makeState([
      {
        id: 'optimistic-follow-up',
        role: 'user',
        content: 'follow up',
        timestamp: 200,
        isPending: false,
        isQueued: true,
      },
    ])

    const next = handleUserMessage(state, processingEvent(300))
    const message = next.state.session.messages[0]

    expect(message.id).toBe('optimistic-follow-up')
    expect(message.timestamp).toBe(300)
    expect(message.isPending).toBe(false)
    expect(message.isQueued).toBe(false)
  })

  it('reconciles a replayed event with a persisted client message id instead of appending a duplicate', () => {
    const state = makeState([
      {
        id: 'backend-user-1',
        clientMessageId: 'optimistic-user-1',
        role: 'user',
        content: 'retry connection test',
        timestamp: 100,
        isPending: true,
      },
    ])
    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'session-1',
      message: {
        id: 'backend-user-1',
        clientMessageId: 'optimistic-user-1',
        role: 'user',
        content: 'retry connection test',
        timestamp: 10_000,
      },
      status: 'accepted',
      optimisticMessageId: 'optimistic-user-1',
    }

    const next = handleUserMessage(state, event)

    expect(next.state.session.messages).toHaveLength(1)
    expect(next.state.session.messages[0]).toMatchObject({
      id: 'backend-user-1',
      clientMessageId: 'optimistic-user-1',
      isPending: false,
    })
  })

  it('does not collapse a visible reply when accepting a hidden system continuation', () => {
    const state: SessionState = {
      session: {
        ...makeState([]).session,
        messages: [
          { id: 'user', role: 'user', content: 'question', timestamp: 100 },
          {
            id: 'answer',
            role: 'assistant',
            content: 'visible partial answer',
            timestamp: 200,
            isStreaming: true,
            isPending: true,
            turnId: 'visible-turn',
          },
        ],
      } as any,
      streaming: { content: 'visible partial answer', turnId: 'visible-turn' },
    }

    const next = handleUserMessage(state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: {
        id: 'hidden-continuation',
        role: 'user',
        content: 'question\n\n[source activated]',
        timestamp: 300,
        hidden: true,
      },
      status: 'accepted',
    })

    expect(next.state.session.messages.find(message => message.id === 'answer')?.hidden).not.toBe(true)
    expect(next.state.streaming).toEqual(state.streaming)
    expect(next.state.session.suppressedTurnIds).toBeUndefined()
    expect(next.state.session.lastMessageAt).toBe(0)
  })

  it('hides a matching optimistic bubble when the backend classifies it as an internal continuation', () => {
    const state = makeState([
      {
        id: 'optimistic-hidden-retry',
        role: 'user',
        content: 'question\n\n[source activated]',
        timestamp: 100,
        isPending: true,
      },
    ])

    const next = handleUserMessage(state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: {
        id: 'backend-hidden-retry',
        role: 'user',
        content: 'question\n\n[source activated]',
        timestamp: 200,
        hidden: true,
      },
      status: 'accepted',
      optimisticMessageId: 'optimistic-hidden-retry',
    })

    expect(next.state.session.messages).toHaveLength(1)
    expect(next.state.session.messages[0]).toMatchObject({
      id: 'optimistic-hidden-retry',
      hidden: true,
      isPending: false,
    })
    expect(next.state.session.lastMessageAt).toBe(0)
  })

  it('applies the canonical timestamp when native steer accepts a queued item', () => {
    const state = makeState([
      {
        id: 'optimistic-follow-up',
        role: 'user',
        content: 'follow up',
        timestamp: 200,
        isPending: false,
        isQueued: true,
        queueId: 'backend-follow-up',
      },
    ])
    const event: UserMessageEvent = {
      ...processingEvent(300),
      status: 'accepted',
    }

    const next = handleUserMessage(state, event)
    const message = next.state.session.messages[0]

    expect(message?.id).toBe('optimistic-follow-up')
    expect(message?.timestamp).toBeGreaterThanOrEqual(300)
    expect(message?.isQueued).toBe(false)
    expect(message?.queueId).toBe('backend-follow-up')
  })

  it('keeps the thought chain under the follow-up and only hides the previous response body', () => {
    const state: SessionState = {
      session: {
        ...makeState([]).session,
        messages: [
          { id: 'initial-user', role: 'user', content: '它有哪几个部分?', timestamp: 100 },
          {
            id: 'prior-answer',
            role: 'assistant',
            content: '根据文稿目录，它主要由前置部分、正文9章组成。',
            timestamp: 150,
            turnId: 'shared-turn',
          },
          {
            id: 'thought-dump',
            role: 'assistant',
            content: '- **前置部分** - 封面及编制信息',
            timestamp: 180,
            isPending: true,
            isIntermediate: true,
            turnId: 'shared-turn',
          },
          {
            id: 'optimistic-follow-up',
            role: 'user',
            content: '请使用列表展示',
            timestamp: 200,
            isQueued: true,
            queueId: 'backend-follow-up',
          },
        ],
        processingStartedAt: 123,
      } as any,
      streaming: { content: '- **前置部分** - 封面及编制信息', turnId: 'shared-turn' },
    }

    const accepted = handleUserMessage(state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: {
        id: 'backend-follow-up',
        role: 'user',
        content: '请使用列表展示',
        timestamp: 300,
      },
      status: 'accepted',
      optimisticMessageId: 'optimistic-follow-up',
    })
    const afterQueueChanged = handleQueueChanged(accepted.state, {
      type: 'queue_changed',
      sessionId: 'session-1',
      messages: [],
    })
    const leftoverDelta = handleTextDelta(afterQueueChanged.state, {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '1. 前置部分\n',
      turnId: 'shared-turn',
    })
    const leftoverComplete = handleTextComplete(leftoverDelta, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '1. 前置部分\n2. 正文9章',
      turnId: 'shared-turn',
      timestamp: 400,
    })
    const nextDelta = handleTextDelta(leftoverComplete, {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '1. 前置部分\n',
      turnId: 'replay-turn',
    })
    const nextComplete = handleTextComplete(nextDelta, {
      type: 'text_complete',
      sessionId: 'session-1',
      text: '1. 前置部分\n2. 正文9章',
      turnId: 'replay-turn',
      timestamp: 500,
    })

    const priorAnswer = afterQueueChanged.state.session.messages.find(message => message.id === 'prior-answer')
    const thoughtDump = afterQueueChanged.state.session.messages.find(message => message.id === 'thought-dump')
    const followUp = afterQueueChanged.state.session.messages.find(message => message.id === 'optimistic-follow-up')
    const leftoverReply = leftoverComplete.session.messages.find(message =>
      message.role === 'assistant' && !message.hidden && message.content.includes('1. 前置部分'),
    )
    const newReply = nextComplete.session.messages.find(message =>
      message.role === 'assistant' && !message.hidden && message.content === '1. 前置部分\n2. 正文9章',
    )
    const turns = groupMessagesByTurn(nextComplete.session.messages)
    const leftoverTurns = groupMessagesByTurn(leftoverComplete.session.messages)
    const pendingTurns = groupMessagesByTurn(nextDelta.session.messages)

    expect(priorAnswer?.hidden).toBe(true)
    expect(thoughtDump?.hidden).toBe(false)
    expect(thoughtDump?.timestamp).toBeGreaterThan(followUp?.timestamp ?? 0)
    expect(accepted.state.streaming).toBeNull()
    expect(accepted.state.session.suppressedTurnIds).toContain('shared-turn')
    expect(followUp?.isQueued).toBe(false)
    expect(followUp?.hidden).toBe(false)
    expect(followUp?.content).toBe('请使用列表展示')
    expect(followUp?.timestamp).toBeGreaterThan(priorAnswer?.timestamp ?? 0)
    expect(leftoverReply).toBeUndefined()
    expect(leftoverTurns.map(turn => turn.type)).toEqual(['user', 'user', 'assistant'])
    expect(leftoverTurns[2]?.type === 'assistant' && leftoverTurns[2].activities.map(activity => activity.content)).toEqual([
      '- **前置部分** - 封面及编制信息',
    ])
    expect(newReply?.id).not.toBe('prior-answer')
    expect(newReply?.timestamp).toBeGreaterThan(followUp?.timestamp ?? 0)
    expect(pendingTurns.map(turn => turn.type)).toEqual(['user', 'user', 'assistant'])
    expect(pendingTurns[2]?.type === 'assistant' && pendingTurns[2].activities.map(activity => activity.content)).toEqual([
      '- **前置部分** - 封面及编制信息',
    ])
    expect(pendingTurns[2]?.type === 'assistant' && pendingTurns[2].response?.isStreaming).toBe(true)
    expect(turns.map(turn => turn.type)).toEqual(['user', 'user', 'assistant'])
    expect(turns[0]?.type === 'user' && turns[0].message.content).toBe('它有哪几个部分?')
    expect(turns[1]?.type === 'user' && turns[1].message.content).toBe('请使用列表展示')
    expect(turns[2]?.type === 'assistant' && turns[2].response?.text).toBe('1. 前置部分\n2. 正文9章')
    expect(accepted.state.session.processingStartedAt).not.toBe(123)
  })

  it('moves thought under a follow-up that was not already in the composer queue', () => {
    const state: SessionState = {
      session: {
        ...makeState([]).session,
        messages: [
          { id: 'initial-user', role: 'user', content: '查看结构', timestamp: 100 },
          { id: 'thought', role: 'assistant', content: '先读文档', timestamp: 150, isIntermediate: true },
          {
            id: 'answer',
            role: 'assistant',
            content: 'partial',
            timestamp: 160,
            isStreaming: true,
            isPending: true,
            turnId: 'live',
          },
        ],
      } as any,
      streaming: { content: 'partial', turnId: 'live' },
    }

    const next = handleUserMessage(state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: { id: 'follow-up', role: 'user', content: '再说摘要', timestamp: 200 },
      status: 'accepted',
    })

    const thought = next.state.session.messages.find(message => message.id === 'thought')
    const followUp = next.state.session.messages.find(message => message.content === '再说摘要')
    expect(next.state.session.messages.find(message => message.id === 'answer')?.hidden).toBe(true)
    expect(thought?.hidden).toBe(false)
    expect(followUp?.isQueued).toBe(false)
    expect(thought?.timestamp).toBeGreaterThan(followUp?.timestamp ?? 0)
    expect(next.state.session.suppressedTurnIds).toContain('live')
  })

  it('hides an earlier steered follow-up so only the latest question stays visible', () => {
    const state = makeState([
      { id: 'initial-user', role: 'user', content: '它有哪几个部分?', timestamp: 100 },
      {
        id: 'prior-answer',
        role: 'assistant',
        content: 'complete answer',
        timestamp: 150,
        hidden: true,
      },
      {
        id: 'first-follow-up',
        role: 'user',
        content: '用列表进行回答',
        timestamp: 300,
        queueId: 'backend-first',
      },
      {
        id: 'first-reply',
        role: 'assistant',
        content: '1. 前置部分',
        timestamp: 350,
        isStreaming: true,
        isPending: true,
      },
      {
        id: 'second-follow-up',
        role: 'user',
        content: '还包括子项',
        timestamp: 400,
        isQueued: true,
        queueId: 'backend-second',
      },
    ])

    const next = handleUserMessage(state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: {
        id: 'backend-second',
        role: 'user',
        content: '还包括子项',
        timestamp: 500,
      },
      status: 'accepted',
      optimisticMessageId: 'second-follow-up',
    })
    const turns = groupMessagesByTurn(next.state.session.messages)

    expect(next.state.session.messages.find(message => message.id === 'first-follow-up')?.hidden).toBe(true)
    expect(next.state.session.messages.find(message => message.id === 'first-reply')?.hidden).toBe(true)
    expect(next.state.session.messages.find(message => message.id === 'second-follow-up')).toMatchObject({
      isQueued: false,
      hidden: false,
      content: '还包括子项',
    })
    expect(turns.map(turn => turn.type)).toEqual(['user', 'user'])
    expect(turns[0]?.type === 'user' && turns[0].message.content).toBe('它有哪几个部分?')
    expect(turns[1]?.type === 'user' && turns[1].message.content).toBe('还包括子项')
  })

  it('keeps in-flight tools visible under the follow-up so the thought chain can continue', () => {
    const state = makeState([
      { id: 'initial-user', role: 'user', content: '阅读下这个文档', timestamp: 100 },
      {
        id: 'old-answer',
        role: 'assistant',
        content: 'old partial',
        timestamp: 140,
        isStreaming: true,
        isPending: true,
        turnId: 'live-turn',
      },
      {
        id: 'finished-read',
        role: 'tool',
        content: '',
        timestamp: 150,
        toolUseId: 'tu-old',
        toolName: 'Read',
        toolStatus: 'completed',
        toolDisplayName: '读取前半部分',
      },
      {
        id: 'live-read',
        role: 'tool',
        content: '',
        timestamp: 160,
        toolUseId: 'tu-live',
        toolName: 'Read',
        toolStatus: 'executing',
        toolDisplayName: '阅读第2374-3874行正文内容',
      },
      {
        id: 'optimistic-follow-up',
        role: 'user',
        content: '给我段落信息（使用表格展示）',
        timestamp: 200,
        isQueued: true,
        queueId: 'backend-follow-up',
      },
    ])

    const accepted = handleUserMessage(state, {
      type: 'user_message',
      sessionId: 'session-1',
      message: {
        id: 'backend-follow-up',
        role: 'user',
        content: '给我段落信息（使用表格展示）',
        timestamp: 300,
      },
      status: 'accepted',
      optimisticMessageId: 'optimistic-follow-up',
    })

    const followUp = accepted.state.session.messages.find(message => message.id === 'optimistic-follow-up')
    const finishedRead = accepted.state.session.messages.find(message => message.id === 'finished-read')
    const liveRead = accepted.state.session.messages.find(message => message.id === 'live-read')
    expect(accepted.state.session.messages.find(message => message.id === 'old-answer')?.hidden).toBe(true)
    expect(accepted.state.session.suppressedTurnIds).toContain('live-turn')
    const leftoverAnswer = handleTextDelta(accepted.state, {
      type: 'text_delta',
      sessionId: 'session-1',
      delta: '这是原文结构的完整回答',
      turnId: 'live-turn',
    })
    expect(leftoverAnswer.session.messages.some(message =>
      message.role === 'assistant' && !message.hidden && message.content.includes('原文结构'),
    )).toBe(false)
    expect(finishedRead?.hidden).toBe(false)
    expect(liveRead?.hidden).toBe(false)
    expect(liveRead?.toolStatus).toBe('executing')
    expect(followUp?.timestamp).toBeGreaterThan(200)
    expect(finishedRead?.timestamp).toBeGreaterThan(followUp?.timestamp ?? 0)
    expect(liveRead?.timestamp).toBeGreaterThan(finishedRead?.timestamp ?? 0)

    const nextTool = handleToolStart(accepted.state, {
      type: 'tool_start',
      sessionId: 'session-1',
      toolUseId: 'tu-next',
      toolName: 'Read',
      toolDisplayName: '读取报告正文第四部分',
    })
    const continued = handleToolStart(nextTool, {
      type: 'tool_start',
      sessionId: 'session-1',
      toolUseId: 'tu-live',
      toolName: 'Read',
      toolDisplayName: '阅读第2374-3874行正文内容',
      toolInput: { offset: 2374 },
    })
    const turns = groupMessagesByTurn(continued.session.messages)
    const assistantTurn = turns.find(turn => turn.type === 'assistant')

    expect(continued.session.messages.filter(message => message.toolUseId === 'tu-live' && !message.hidden)).toHaveLength(1)
    expect(continued.session.messages.find(message => message.toolUseId === 'tu-live')?.toolInput).toEqual({ offset: 2374 })
    expect(turns.map(turn => turn.type)).toEqual(['user', 'user', 'assistant'])
    expect(assistantTurn?.type).toBe('assistant')
    if (assistantTurn?.type === 'assistant') {
      expect(assistantTurn.activities.map(activity => activity.displayName)).toEqual([
        '读取前半部分',
        '阅读第2374-3874行正文内容',
        '读取报告正文第四部分',
      ])
    }
  })

  it('keeps the completed prior answer above the replayed message in live grouping', () => {
    const state = makeState([
      { id: 'initial-user', role: 'user', content: 'question', timestamp: 100 },
      {
        id: 'optimistic-follow-up',
        role: 'user',
        content: 'follow up',
        timestamp: 200,
        isQueued: true,
      },
      {
        id: 'prior-answer',
        role: 'assistant',
        content: 'complete answer',
        timestamp: 250,
      },
    ])

    const next = handleUserMessage(state, processingEvent(300))
    const turns = groupMessagesByTurn(next.state.session.messages)

    expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant', 'user'])
    const assistantTurn = turns[1]
    expect(assistantTurn?.type).toBe('assistant')
    if (assistantTurn?.type === 'assistant') {
      expect(assistantTurn.response?.text).toBe('complete answer')
    }
  })

  it('ignores a late queued event after the message is already processing', () => {
    const state = makeState([
      {
        id: 'optimistic-follow-up',
        role: 'user',
        content: 'follow up',
        timestamp: 300,
        isQueued: false,
        isPending: false,
      },
    ])
    const lateQueuedEvent: UserMessageEvent = {
      ...processingEvent(200),
      status: 'queued',
    }

    const next = handleUserMessage(state, lateQueuedEvent)

    expect(next.state).toBe(state)
    expect(next.state.session.messages[0]?.timestamp).toBe(300)
    expect(next.state.session.messages[0]?.isQueued).toBe(false)
  })

  it('promotes a mis-tagged optimistic follow-up into the queue without collapsing the live turn (#94)', () => {
    const state: SessionState = {
      session: {
        ...makeState([]).session,
        isProcessing: false,
        processingStartedAt: 123,
        lastMessageAt: 100,
        lastMessageRole: 'assistant',
        messages: [
          { id: 'u1', role: 'user', content: 'current task', timestamp: 90 },
          {
            id: 'thought',
            role: 'assistant',
            content: '先读文档',
            timestamp: 95,
            isIntermediate: true,
          },
          {
            id: 'live-tool',
            role: 'tool',
            content: '',
            timestamp: 100,
            toolUseId: 'tu-live',
            toolName: 'Read',
            toolStatus: 'executing',
          },
          {
            id: 'optimistic-follow-up',
            role: 'user',
            content: 'follow up',
            timestamp: 200,
            isPending: true,
            isQueued: false,
          },
        ],
      } as any,
      streaming: { content: 'still thinking', turnId: 'turn-active' },
    }

    const next = handleUserMessage(state, {
      ...processingEvent(200),
      status: 'queued',
    })
    const turns = groupMessagesByTurn(next.state.session.messages, { isSessionProcessing: true })
    const followUp = next.state.session.messages.find(message => message.id === 'optimistic-follow-up')

    expect(next.state).not.toBe(state)
    expect(followUp).toMatchObject({
      isQueued: true,
      isPending: false,
      queueId: 'backend-follow-up',
    })
    expect(followUp?.hidden).not.toBe(true)
    expect(next.state.session.messages.find(message => message.id === 'thought')?.hidden).not.toBe(true)
    expect(next.state.session.messages.find(message => message.id === 'live-tool')?.hidden).not.toBe(true)
    expect(next.state.session.messages.find(message => message.id === 'live-tool')?.toolStatus).toBe('executing')
    expect(next.state.streaming).toEqual(state.streaming)
    expect(next.state.session.suppressedTurnIds).toBeUndefined()
    expect(next.state.session.processingStartedAt).toBe(123)
    expect(next.state.session.lastMessageAt).toBe(100)
    expect(next.state.session.lastMessageRole).toBe('assistant')
    expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant'])
    expect(turns.some(turn => turn.type === 'user' && turn.message.content === 'follow up')).toBe(false)
  })

  it('keeps the active turn and streaming state intact when a message is queued', () => {
    const state: SessionState = {
      session: {
        ...makeState([]).session,
        isProcessing: true,
        processingStartedAt: 123,
        lastMessageAt: 100,
        lastMessageRole: 'assistant',
        messages: [
          { id: 'u1', role: 'user', content: 'current task', timestamp: 90 },
          {
            id: 'live-answer',
            role: 'assistant',
            content: 'still streaming',
            timestamp: 100,
            isStreaming: true,
            isPending: true,
            turnId: 'turn-active',
          },
        ],
      },
      streaming: { content: 'still streaming', turnId: 'turn-active' },
    }
    const event: UserMessageEvent = {
      ...processingEvent(200),
      status: 'queued',
    }

    const next = handleUserMessage(state, event)
    const turns = groupMessagesByTurn(next.state.session.messages, { isSessionProcessing: true })

    expect(next.state.session.isProcessing).toBe(true)
    expect(next.state.session.processingStartedAt).toBe(123)
    expect(next.state.streaming).toEqual(state.streaming)
    expect(next.state.session.messages.find(message => message.content === 'follow up')).toMatchObject({
      isQueued: true,
      queueId: 'backend-follow-up',
    })
    expect(next.state.session.lastMessageAt).toBe(100)
    expect(next.state.session.lastMessageRole).toBe('assistant')
    expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant'])
    const assistantTurn = turns[1]
    expect(assistantTurn?.type).toBe('assistant')
    if (assistantTurn?.type === 'assistant') {
      expect(assistantTurn.response?.isStreaming).toBe(true)
      expect(assistantTurn.response?.text).toBe('still streaming')
    }
  })

  it('applies canonical queue edits and ordering without touching formal messages', () => {
    const state = makeState([
      { id: 'u1', role: 'user', content: 'current', timestamp: 1 },
      { id: 'optimistic-a', queueId: 'queue-a', role: 'user', content: 'a', timestamp: 2, isQueued: true },
      { id: 'optimistic-b', queueId: 'queue-b', role: 'user', content: 'b', timestamp: 3, isQueued: true },
    ])
    const event: QueueChangedEvent = {
      type: 'queue_changed',
      sessionId: 'session-1',
      messages: [
        { id: 'queue-b', role: 'user', content: 'b edited', timestamp: 3, isQueued: true },
        { id: 'queue-a', role: 'user', content: 'a', timestamp: 2, isQueued: true },
      ],
    }

    const next = handleQueueChanged(state, event)

    expect(next.state.session.messages.map(message => message.id)).toEqual([
      'u1',
      'optimistic-b',
      'optimistic-a',
    ])
    expect(next.state.session.messages[1]?.content).toBe('b edited')
    expect(next.state.session.isProcessing).toBe(true)
  })
})
