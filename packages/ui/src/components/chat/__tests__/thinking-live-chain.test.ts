/**
 * DeepSeek reasoning_content is a thinking block followed by a tool call.
 * While an explicit-v1 run is open, that live text must stay in the process
 * chain. Only the final answer occupies the reply.
 */
import { describe, expect, it } from 'bun:test'
import { messageToStored, storedToMessage, type Message } from '@craft-agent/core'
import { groupMessagesByTurn } from '../turn-utils'

const protocol = {
  answerProtocol: 'explicit-v1' as const,
  answerRunId: 'run-deepseek',
  answerRoutingVersion: 1 as const,
  presentationProtocol: 'legacy' as const,
}

function user(): Message {
  return { id: 'user', role: 'user', content: '这张图存在什么问题？', timestamp: 1, ...protocol }
}

function thinking(id: string, content: string, timestamp: number, turnId: string, live: boolean): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    turnId,
    phase: 'intermediate',
    streamKind: 'thinking',
    presentationProtocol: 'legacy',
    isIntermediate: true,
    isStreaming: live,
    isPending: live,
    ...protocol,
  }
}

function tool(id: string, timestamp: number): Message {
  return {
    id,
    role: 'tool',
    content: 'ok',
    timestamp,
    toolName: 'Read',
    toolUseId: id,
    toolStatus: 'completed',
    toolResult: 'ok',
    toolPurpose: 'work',
    ...protocol,
  }
}

function assistant(messages: Message[], processing = true) {
  const turn = groupMessagesByTurn(messages, { isSessionProcessing: processing }).find(item => item.type === 'assistant')
  if (!turn || turn.type !== 'assistant') throw new Error('expected assistant turn')
  return turn
}

const first = 'Now I can read the template and the numbers do not add up.'
const second = 'The signature is stale, so the displayed total cannot be the answer.'
const reply = '图里的推理被当成了正文。进程链才是它该在的地方。'

describe('deepseek thinking stays in the process chain', () => {
  it('folds a live reasoning block under an open explicit-v1 run', () => {
    const turn = assistant([
      user(),
      tool('read-1', 2),
      thinking('think-live', first, 3, 'pi-turn-0__think0', true),
    ])
    expect(turn.response).toBeUndefined()
    expect(turn.activities.map(activity => activity.type)).toEqual(['tool', 'thinking'])
    expect(turn.activities.find(activity => activity.type === 'thinking')).toMatchObject({
      content: first,
      status: 'running',
    })
  })

  it('keeps each completed round in the chain and the final answer below it', () => {
    const messages: Message[] = [
      user(),
      thinking('think-1', first, 2, 'pi-turn-0__think0', false),
      tool('read-1', 3),
      thinking('think-2', second, 4, 'pi-turn-0__think2', true),
      tool('read-2', 5),
      {
        id: 'answer',
        role: 'assistant',
        content: reply,
        timestamp: 6,
        turnId: 'pi-turn-0__m4',
        phase: 'final',
        presentationProtocol: 'legacy',
        isIntermediate: false,
        isStreaming: true,
        isPending: true,
        ...protocol,
      },
    ]
    const live = assistant(messages)
    expect(live.response).toMatchObject({ text: reply, isStreaming: true })
    expect(live.activities.map(activity => activity.type)).toEqual(['thinking', 'tool', 'thinking', 'tool'])
    expect(live.activities.filter(activity => activity.type === 'thinking').map(activity => activity.content)).toEqual([first, second])
    expect(live.response?.text).not.toContain('Now I can read')

    const settled = messages.map(message => message.id === 'answer'
      ? { ...message, isStreaming: false, isPending: false, answerCommitted: true }
      : message.id === 'think-2'
        ? { ...message, isStreaming: false, isPending: false }
        : message)
    const done = assistant(settled, false)
    expect(done.response).toMatchObject({ text: reply, isStreaming: false })
    expect(done.activities.filter(activity => activity.type === 'thinking')).toHaveLength(2)

    const stored = settled.map(messageToStored)
    expect(stored.filter(message => message.streamKind === 'thinking').map(message => message.content)).toEqual([first, second])
    const reloaded = JSON.parse(JSON.stringify(stored)).map(storedToMessage)
    const restored = assistant(reloaded, false)
    expect(restored.response?.text).toBe(reply)
    expect(restored.activities.filter(activity => activity.type === 'thinking').map(activity => ({
      content: activity.content,
      status: activity.status,
    }))).toEqual([
      { content: first, status: 'completed' },
      { content: second, status: 'completed' },
    ])
  })

  it('does not treat a legacy unclassified thinking turn as reply text', () => {
    const turn = assistant([
      user(),
      {
        id: 'think',
        role: 'assistant',
        content: first,
        timestamp: 2,
        turnId: 'pi-turn-0__think0',
        phase: 'unclassified',
        presentationProtocol: 'legacy',
        isIntermediate: false,
        isStreaming: true,
        isPending: true,
      },
    ])
    expect(turn.response).toBeUndefined()
    expect(turn.activities[0]).toMatchObject({ type: 'thinking', status: 'running', content: first })
  })
})
