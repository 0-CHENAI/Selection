/**
 * Issue #58: intermediate body card must stay readable when tools start.
 *
 * Live UI binds `turn.response` to ResponseCard. Pending tokens already live
 * there; if text_complete(isIntermediate) cleared that slot, the card
 * unmounted the moment the first tool appeared.
 */

import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import {
  deriveTurnPhase,
  groupMessagesByTurn,
  isMirroredCommentaryActivity,
  isVisibleCommentaryCard,
  type AssistantTurn,
} from '../turn-utils'

function user(content: string, timestamp = 1): Message {
  return { id: `user-${timestamp}`, role: 'user', content, timestamp }
}

function pendingAssistant(id: string, content: string, timestamp: number): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    isStreaming: true,
    isPending: true,
  }
}

function completeIntermediate(message: Message, content = message.content): Message {
  return {
    ...message,
    content,
    isStreaming: false,
    isPending: false,
    isIntermediate: true,
  }
}

function tool(status: 'running' | 'completed', timestamp: number, name = 'Read'): Message {
  return {
    id: `tool-${timestamp}`,
    role: 'tool',
    content: status === 'completed' ? 'ok' : '',
    timestamp,
    toolName: name,
    toolUseId: `tu-${timestamp}`,
    toolStatus: status === 'completed' ? 'completed' : undefined,
    toolResult: status === 'completed' ? 'ok' : undefined,
  }
}

function finalAssistant(id: string, content: string, timestamp: number, streaming = false): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    isStreaming: streaming,
    isPending: streaming,
  }
}

function assistantTurn(turns: ReturnType<typeof groupMessagesByTurn>): AssistantTurn {
  const turn = turns.find(item => item.type === 'assistant')
  if (!turn || turn.type !== 'assistant') {
    throw new Error('expected an assistant turn')
  }
  return turn
}

describe('issue #58 — text then tools keeps the body readable', () => {
  it('pending tokens stay on the response card, not a thought row', () => {
    const pending = pendingAssistant('msg-body', '先说明接下来要读哪个文件。', 10)
    const turn = assistantTurn(groupMessagesByTurn([user('帮我改文档'), pending]))

    expect(turn.activities).toEqual([])
    expect(turn.response?.text).toBe('先说明接下来要读哪个文件。')
    expect(turn.response?.isStreaming).toBe(true)
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(false)
    expect(deriveTurnPhase(turn)).toBe('streaming')
  })

  it('reclassifying that body as intermediate keeps the same card text', () => {
    const pending = pendingAssistant('msg-body', '先说明接下来要读哪个文件。', 10)
    const turn = assistantTurn(groupMessagesByTurn([
      user('帮我改文档'),
      completeIntermediate(pending),
    ]))

    expect(turn.response?.text).toBe('先说明接下来要读哪个文件。')
    expect(turn.response?.messageId).toBe('msg-body')
    expect(turn.response?.isStreaming).toBe(false)
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(true)
    expect(turn.activities.map(activity => activity.id)).toEqual(['msg-body'])
    expect(deriveTurnPhase(turn)).toBe('awaiting')
  })

  it('starting a tool after that body does not drop the card', () => {
    const pending = pendingAssistant('msg-body', '先说明接下来要读哪个文件。', 10)
    const turn = assistantTurn(groupMessagesByTurn([
      user('帮我改文档'),
      completeIntermediate(pending),
      tool('running', 20),
    ]))

    expect(turn.response?.text).toBe('先说明接下来要读哪个文件。')
    expect(turn.response?.messageId).toBe('msg-body')
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(true)
    expect(turn.activities.map(activity => activity.type)).toEqual(['intermediate', 'tool'])
    expect(deriveTurnPhase(turn)).toBe('tool_active')
    expect(turn.isComplete).toBe(false)
  })

  it('fast tool completion still leaves the body reviewable as commentary', () => {
    const pending = pendingAssistant('msg-body', '接下来会检查目录结构。', 10)
    const turn = assistantTurn(groupMessagesByTurn([
      user('查看结构'),
      completeIntermediate(pending),
      tool('completed', 11),
    ]))

    expect(turn.response?.text).toBe('接下来会检查目录结构。')
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(true)
    expect(deriveTurnPhase(turn)).toBe('awaiting')
  })

  it('a later streaming reply replaces commentary without losing the history row', () => {
    const pending = pendingAssistant('msg-body', '我先读文件。', 10)
    const turn = assistantTurn(groupMessagesByTurn([
      user('查看结构'),
      completeIntermediate(pending),
      tool('completed', 20),
      finalAssistant('msg-final', '报告分为三部分', 30, true),
    ]))

    expect(turn.activities.filter(activity => activity.type === 'intermediate').map(activity => activity.content))
      .toEqual(['我先读文件。'])
    expect(turn.response?.text).toBe('报告分为三部分')
    expect(turn.response?.isStreaming).toBe(true)
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(false)
    expect(deriveTurnPhase(turn)).toBe('streaming')
  })

  it('the later final reply becomes the card, commentary stays in the work chain', () => {
    const pending = pendingAssistant('msg-body', '我先读文件。', 10)
    const turns = groupMessagesByTurn([
      user('查看结构'),
      completeIntermediate(pending),
      tool('completed', 20),
      finalAssistant('msg-final', '报告分为三部分。', 30),
    ])
    const turn = assistantTurn(turns)

    expect(turn.response?.text).toBe('报告分为三部分。')
    expect(turn.response?.isCommentary).toBeFalsy()
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(false)
    expect(turn.activities.some(activity => activity.id === 'msg-body' && activity.content === '我先读文件。')).toBe(true)
    expect(turn.isComplete).toBe(true)
    expect(deriveTurnPhase(turn)).toBe('complete')
  })

  it('session-complete still promotes leftover commentary into a final card', () => {
    const pending = pendingAssistant('msg-body', '已经改完这一段。', 10)
    const turn = assistantTurn(groupMessagesByTurn([
      user('改一下'),
      completeIntermediate(pending),
      tool('completed', 20),
    ], { isSessionProcessing: false }))

    expect(turn.isComplete).toBe(true)
    expect(turn.response?.text).toBe('已经改完这一段。')
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(false)
    expect(deriveTurnPhase(turn)).toBe('complete')
  })

  it('latest commentary updates the card when the model speaks again before more tools', () => {
    const first = completeIntermediate(pendingAssistant('msg-one', '先看配置。', 10))
    const second = completeIntermediate(pendingAssistant('msg-two', '配置没有问题，接着跑测试。', 15))
    const turn = assistantTurn(groupMessagesByTurn([
      user('检查一下'),
      first,
      tool('completed', 12),
      second,
      tool('running', 18, 'Bash'),
    ]))

    expect(turn.response?.text).toBe('配置没有问题，接着跑测试。')
    expect(turn.response?.messageId).toBe('msg-two')
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(true)
    expect(turn.activities.filter(activity => activity.type === 'intermediate')).toHaveLength(2)
    expect(deriveTurnPhase(turn)).toBe('tool_active')
  })
})

describe('issue #81 — false-final `|` must not break the work chain', () => {
  it('reopens the flushed turn when a tool arrives after a pipe-only final', () => {
    const turns = groupMessagesByTurn([
      user('继续检查文档'),
      finalAssistant('msg-pipe', '|', 10),
      tool('running', 20),
      tool('completed', 21, 'Read'),
    ])
    const assistantTurns = turns.filter(item => item.type === 'assistant')
    expect(assistantTurns).toHaveLength(1)
    const turn = assistantTurns[0] as AssistantTurn
    expect(turn.response).toBeUndefined()
    expect(turn.activities.filter(activity => activity.type === 'tool')).toHaveLength(2)
    expect(turn.isComplete).toBe(false)
  })

  it('keeps one work chain when tools continue after a false final', () => {
    const turns = groupMessagesByTurn([
      user('继续检查文档'),
      tool('completed', 8, 'Read'),
      tool('completed', 9, 'Read'),
      finalAssistant('msg-pipe', '|', 10),
      tool('running', 20, 'Edit'),
      tool('completed', 21, 'Edit'),
    ])
    const assistantTurns = turns.filter(item => item.type === 'assistant')
    expect(assistantTurns).toHaveLength(1)
    const turn = assistantTurns[0] as AssistantTurn
    expect(turn.activities.filter(activity => activity.type === 'tool')).toHaveLength(4)
    expect(turn.response).toBeUndefined()
    expect(turn.isComplete).toBe(false)
  })

  it('keeps commentary and later tools on the same turn after a false final', () => {
    const turn = assistantTurn(groupMessagesByTurn([
      user('继续检查文档'),
      tool('completed', 8, 'Read'),
      finalAssistant('msg-pipe', '|', 10),
      completeIntermediate(pendingAssistant('msg-next', '接着检查段落属性。', 15)),
      tool('running', 20, 'Edit'),
    ]))
    expect(turn.activities.filter(activity => activity.type === 'tool')).toHaveLength(2)
    expect(turn.response?.text).toBe('接着检查段落属性。')
    expect(turn.response?.isCommentary).toBe(true)
    expect(turn.isComplete).toBe(false)
  })

  it('keeps real commentary readable when a later tool arrives after a false final', () => {
    const turn = assistantTurn(groupMessagesByTurn([
      user('继续检查文档'),
      finalAssistant('msg-body', '先读 skill 文件再继续。', 10),
      tool('running', 20),
    ]))
    expect(turn.response?.text).toBe('先读 skill 文件再继续。')
    expect(turn.response?.isCommentary).toBe(true)
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(true)
    expect(turn.isComplete).toBe(false)
  })

  it('does not treat pipe-only commentary as a visible card', () => {
    const turn = assistantTurn(groupMessagesByTurn([
      user('继续'),
      completeIntermediate(pendingAssistant('msg-pipe', '|', 10)),
      tool('running', 20),
    ]))
    expect(turn.response).toBeUndefined()
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(false)
  })

  it('does not flush a pipe-only final into a finished empty card', () => {
    const turns = groupMessagesByTurn([
      user('继续'),
      finalAssistant('msg-pipe', '|', 10),
    ], { isSessionProcessing: true })
    expect(turns.filter(item => item.type === 'assistant')).toHaveLength(0)
  })

  it('does not let a pipe-only final complete a live work chain', () => {
    const turn = assistantTurn(groupMessagesByTurn([
      user('继续检查文档'),
      tool('completed', 8, 'Read'),
      finalAssistant('msg-pipe', '|', 10),
    ], { isSessionProcessing: true }))
    expect(turn.isComplete).toBe(false)
    expect(turn.response).toBeUndefined()
    expect(deriveTurnPhase(turn)).toBe('awaiting')
  })

  it('does not promote Read line-number dumps as empty cards', () => {
    const turn = assistantTurn(groupMessagesByTurn([
      user('继续'),
      completeIntermediate(pendingAssistant('msg-read', '     1|---\n     2|name: officecli', 10)),
      tool('running', 20),
    ]))
    expect(turn.response?.text).toContain('name: officecli')
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(true)
  })
})

describe('isVisibleCommentaryCard', () => {
  it('is only visible while the turn is still open', () => {
    const response = { text: '说明', isStreaming: false, isCommentary: true, messageId: 'm1' }
    expect(isVisibleCommentaryCard(response, false)).toBe(true)
    expect(isVisibleCommentaryCard(response, true)).toBe(false)
    expect(isVisibleCommentaryCard({ ...response, isCommentary: false }, false)).toBe(false)
    expect(isVisibleCommentaryCard(undefined, false)).toBe(false)
  })
})

describe('work-chain row visibility', () => {
  it('hides the mirrored commentary row until a tool needs the work chain', () => {
    const pending = pendingAssistant('msg-body', '先说明接下来要读哪个文件。', 10)
    const beforeTools = assistantTurn(groupMessagesByTurn([
      user('帮我改文档'),
      completeIntermediate(pending),
    ]))
    const commentaryRow = beforeTools.activities.find(activity => activity.id === 'msg-body')
    expect(commentaryRow).toBeDefined()
    expect(isMirroredCommentaryActivity(commentaryRow!, beforeTools.response, beforeTools.isComplete)).toBe(true)

    const withTool = assistantTurn(groupMessagesByTurn([
      user('帮我改文档'),
      completeIntermediate(pending),
      tool('running', 20),
    ]))
    const stillMirrored = withTool.activities.find(activity => activity.id === 'msg-body')
    const toolRow = withTool.activities.find(activity => activity.type === 'tool')
    expect(isMirroredCommentaryActivity(stillMirrored!, withTool.response, withTool.isComplete)).toBe(true)
    expect(isMirroredCommentaryActivity(toolRow!, withTool.response, withTool.isComplete)).toBe(false)
  })

  it('empty intermediate text does not wipe a readable card', () => {
    const pending = pendingAssistant('msg-body', '先说明接下来要读哪个文件。', 10)
    const empty = {
      ...completeIntermediate(pending),
      id: 'msg-empty',
      content: '   ',
      timestamp: 15,
    }
    const turn = assistantTurn(groupMessagesByTurn([
      user('帮我改文档'),
      completeIntermediate(pending),
      empty,
    ]))

    expect(turn.response?.text).toBe('先说明接下来要读哪个文件。')
    expect(turn.response?.messageId).toBe('msg-body')
    expect(isVisibleCommentaryCard(turn.response, turn.isComplete)).toBe(true)
  })
})
