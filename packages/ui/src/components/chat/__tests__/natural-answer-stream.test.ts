import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { groupMessagesByTurn } from '../turn-utils'

const protocol = { answerProtocol: 'explicit-v1' as const, answerRunId: 'run', presentationProtocol: 'native' as const }
const user: Message = { id: 'user', role: 'user', content: '问题', timestamp: 1, ...protocol }
function live(content: string, extra: Partial<Message> = {}): Message {
  return { id: 'r-1', role: 'assistant', content, timestamp: 2, turnId: 'pi-turn-1__m3', phase: 'intermediate',
    isStreaming: true, isPending: true, isIntermediate: true, ...protocol, ...extra } as Message
}
const assistantTurn = (messages: Message[]) => {
  const turn = groupMessagesByTurn(messages, { isSessionProcessing: true }).find(t => t.type === 'assistant')
  return turn?.type === 'assistant' ? turn : undefined
}

describe('natural-v1 live streams (frameless replies)', () => {
  it('shows every live stream in the reply slot, short or long, without classifying it', () => {
    for (const text of ['我先读取文件。', '## 结论\n\n- 换门胜率 2/3']) {
      const turn = assistantTurn([user, live(text)])
      expect(turn?.response).toMatchObject({ text, isStreaming: true, isCommentary: false, streamKey: 'pi-turn-1__m3' })
      // Not mirrored into the work chain while it streams.
      expect(turn?.activities).toHaveLength(0)
    }
  })

  it('keeps the stream key when the host commits the draft under its server id', () => {
    const turn = assistantTurn([user, live('不客气！', {
      id: 'msg-server', isStreaming: false, isPending: false, isIntermediate: false, phase: 'final', answerCommitted: true,
    })])
    expect(turn?.response).toMatchObject({ text: '不客气！', isStreaming: false, streamKey: 'pi-turn-1__m3', messageId: 'msg-server' })
  })

  it('merges a stream that ended in a tool call into the work chain and frees the reply slot', () => {
    const turn = assistantTurn([user,
      live('我先读取文件。', { isStreaming: false, isPending: false }),
      { id: 'tool', role: 'tool', content: '', toolName: 'Read', toolUseId: 't', toolStatus: 'executing', timestamp: 3, ...protocol } as Message,
    ])
    expect(turn?.response).toBeFalsy()
    expect(turn?.activities.map(a => a.type === 'intermediate' ? a.content : a.toolName)).toEqual(['我先读取文件。', 'Read'])
  })

  it('gives the next stream its own block identity', () => {
    const turn = assistantTurn([user,
      live('我先读取文件。', { isStreaming: false, isPending: false }),
      { id: 'tool', role: 'tool', content: '', toolName: 'Read', toolUseId: 't', toolStatus: 'completed', toolResult: 'ok', timestamp: 3, ...protocol } as Message,
      live('读取完成，结论是……', { id: 'r-2', timestamp: 4, turnId: 'pi-turn-2__m4' }),
    ])
    expect(turn?.response).toMatchObject({ streamKey: 'pi-turn-2__m4', isStreaming: true })
  })
})
