/**
 * Scenario tests for turn lifecycle transitions.
 *
 * These tests verify the turn phase transitions through realistic
 * message flow scenarios, ensuring the state machine correctly
 * handles all common use cases.
 */

import { describe, it, expect } from 'bun:test'
import { deriveTurnPhase, groupMessagesByTurn, shouldShowStreamingFooter, type AssistantTurn } from '../turn-utils'
import type { Message } from '@craft-agent/core'

// ============================================================================
// Test Helpers
// ============================================================================

let messageIdCounter = 0
let turnIdCounter = 0

function resetCounters() {
  messageIdCounter = 0
  turnIdCounter = 0
}

function createUserMessage(content = 'Hello'): Message {
  return {
    id: `user-${++messageIdCounter}`,
    role: 'user',
    content,
    timestamp: Date.now() + messageIdCounter * 100,
  }
}

function createToolMessage(
  status: 'running' | 'completed',
  name = 'Read',
  turnId?: string
): Message {
  return {
    id: `tool-${++messageIdCounter}`,
    role: 'tool',
    content: status === 'completed' ? 'Tool result' : '',
    timestamp: Date.now() + messageIdCounter * 100,
    toolName: name,
    toolUseId: `tu-${messageIdCounter}`,
    toolStatus: status === 'completed' ? 'completed' : undefined,
    toolResult: status === 'completed' ? 'Tool result' : undefined,
    turnId: turnId || `turn-${turnIdCounter}`,
  }
}

function createAssistantMessage(
  isStreaming: boolean,
  isIntermediate = false,
  turnId?: string
): Message {
  return {
    id: `assistant-${++messageIdCounter}`,
    role: 'assistant',
    content: 'Response text',
    timestamp: Date.now() + messageIdCounter * 100,
    isStreaming,
    isIntermediate,
    turnId: turnId || `turn-${turnIdCounter}`,
  }
}

/** Update a message in the array (simulating streaming updates) */
function updateMessage(
  messages: Message[],
  id: string,
  updates: Partial<Message>
): Message[] {
  return messages.map(m => (m.id === id ? { ...m, ...updates } : m))
}

/** Get the last assistant turn from grouped turns */
function getLastAssistantTurn(turns: ReturnType<typeof groupMessagesByTurn>): AssistantTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.type === 'assistant') {
      return turns[i] as AssistantTurn
    }
  }
  return undefined
}

// ============================================================================
// Scenario Tests
// ============================================================================

describe('turn lifecycle scenarios', () => {
  describe('simple response flow', () => {
    it('pending → streaming → complete (no tools)', () => {
      resetCounters()

      // 1. User message
      let messages: Message[] = [createUserMessage()]
      let turns = groupMessagesByTurn(messages)
      // No assistant turn yet
      expect(getLastAssistantTurn(turns)).toBeUndefined()

      // 2. Response starts streaming
      messages = [...messages, createAssistantMessage(true)]
      turns = groupMessagesByTurn(messages)
      let assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('streaming')

      // 3. Response completes
      messages = updateMessage(messages, 'assistant-2', { isStreaming: false })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('complete')
    })
  })

  describe('single tool flow', () => {
    it('pending → tool_active → awaiting → streaming → complete', () => {
      resetCounters()
      turnIdCounter++

      // 1. User message
      let messages: Message[] = [createUserMessage()]

      // 2. Tool starts running
      messages = [...messages, createToolMessage('running')]
      let turns = groupMessagesByTurn(messages)
      let assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('tool_active')

      // 3. Tool completes - THIS IS THE GAP
      messages = updateMessage(messages, 'tool-2', {
        toolStatus: 'completed',
        toolResult: 'File contents...',
      })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('awaiting')

      // 4. Response starts streaming
      messages = [...messages, createAssistantMessage(true)]
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('streaming')

      // 5. Response completes
      messages = updateMessage(messages, 'assistant-3', { isStreaming: false })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('complete')
    })
  })

  describe('multi-tool flow', () => {
    it('tool_active → awaiting → tool_active → awaiting → streaming → complete', () => {
      resetCounters()
      turnIdCounter++

      // 1. First tool starts
      let messages: Message[] = [
        createUserMessage(),
        createToolMessage('running', 'Read'),
      ]
      let turns = groupMessagesByTurn(messages)
      let assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('tool_active')

      // 2. First tool completes - GAP
      messages = updateMessage(messages, 'tool-2', {
        toolStatus: 'completed',
        toolResult: 'File contents...',
      })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('awaiting')

      // 3. Second tool starts
      messages = [...messages, createToolMessage('running', 'Grep')]
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('tool_active')

      // 4. Second tool completes - GAP
      messages = updateMessage(messages, 'tool-3', {
        toolStatus: 'completed',
        toolResult: 'Search results...',
      })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('awaiting')

      // 5. Response starts
      messages = [...messages, createAssistantMessage(true)]
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('streaming')

      // 6. Response completes
      messages = updateMessage(messages, 'assistant-4', { isStreaming: false })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('complete')
    })
  })

  describe('parallel tools flow', () => {
    it('handles multiple tools running in parallel', () => {
      resetCounters()
      turnIdCounter++

      // 1. Multiple tools start
      let messages: Message[] = [
        createUserMessage(),
        createToolMessage('running', 'Read'),
        createToolMessage('running', 'Grep'),
      ]
      let turns = groupMessagesByTurn(messages)
      let assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('tool_active')

      // 2. First tool completes (second still running)
      messages = updateMessage(messages, 'tool-2', {
        toolStatus: 'completed',
        toolResult: 'File contents...',
      })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('tool_active') // Still running

      // 3. Second tool completes - GAP
      messages = updateMessage(messages, 'tool-3', {
        toolStatus: 'completed',
        toolResult: 'Search results...',
      })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('awaiting')
    })
  })

  describe('tool with error', () => {
    it('error transitions to awaiting (not stuck in tool_active)', () => {
      resetCounters()
      turnIdCounter++

      // 1. Tool starts
      let messages: Message[] = [
        createUserMessage(),
        createToolMessage('running', 'Read'),
      ]
      let turns = groupMessagesByTurn(messages)
      let assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('tool_active')

      // 2. Tool errors
      messages = updateMessage(messages, 'tool-2', {
        toolStatus: 'completed',
        toolResult: undefined,
        isError: true,
        content: 'File not found',
      })
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('awaiting')
    })
  })

  describe('interruption', () => {
    it('user message during tool_active marks turn complete', () => {
      resetCounters()
      turnIdCounter++

      // 1. Tool running
      let messages: Message[] = [
        createUserMessage('First question'),
        createToolMessage('running', 'Read'),
      ]
      let turns = groupMessagesByTurn(messages)
      let assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('tool_active')

      // 2. User interrupts with new message
      messages = [...messages, createUserMessage('Cancel that')]
      turns = groupMessagesByTurn(messages)
      // First assistant turn should now be complete (interrupted)
      const firstAssistantTurn = turns.find(t => t.type === 'assistant') as AssistantTurn
      expect(firstAssistantTurn.isComplete).toBe(true)
      expect(deriveTurnPhase(firstAssistantTurn)).toBe('complete')
    })
  })

  describe('intermediate text', () => {
    it('intermediate text during tool sequence stays in awaiting', () => {
      resetCounters()
      turnIdCounter++

      // 1. Tool completes
      let messages: Message[] = [
        createUserMessage(),
        createToolMessage('running', 'Read'),
      ]
      messages = updateMessage(messages, 'tool-2', {
        toolStatus: 'completed',
        toolResult: 'File contents...',
      })
      let turns = groupMessagesByTurn(messages)
      let assistantTurn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(assistantTurn)).toBe('awaiting')

      // 2. Intermediate text arrives (thinking out loud)
      messages = [...messages, createAssistantMessage(false, true)]
      turns = groupMessagesByTurn(messages)
      assistantTurn = getLastAssistantTurn(turns)!
      // Still awaiting because intermediate text is not the final response
      expect(deriveTurnPhase(assistantTurn)).toBe('awaiting')
    })
  })

  // Mirrors the messaging-gateway/renderer.ts lastAssistantText fallback (PR #779).
  // When the Pi agent emits intermediate text + a tool call and then completes
  // without a non-intermediate text_complete, the chat must not sit on "Thinking…"
  // forever. The session.isProcessing=false signal triggers the existing
  // "promote last intermediate text to response" branch in groupMessagesByTurn.
  describe('tool-terminated run — session-complete fallback', () => {
    it('intermediate text + completed tool + session done → phase complete, intermediate promoted to response', () => {
      resetCounters()
      turnIdCounter++

      const messages: Message[] = [
        createUserMessage('do the thing'),
        createAssistantMessage(false, /* isIntermediate */ true), // "I'll run the requested echo hello"
        createToolMessage('completed', 'Bash'),
      ]
      const turns = groupMessagesByTurn(messages, { isSessionProcessing: false })
      const turn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(turn)).toBe('complete')
      expect(turn.response?.text).toBe('Response text') // promoted from the intermediate
      expect(turn.activities.every(activity => activity.content !== 'Response text')).toBe(true)
    })

    it('intermediate text + completed tool + session still processing → phase awaiting', () => {
      resetCounters()
      turnIdCounter++

      const messages: Message[] = [
        createUserMessage('do the thing'),
        createAssistantMessage(false, true),
        createToolMessage('completed', 'Bash'),
      ]
      const turns = groupMessagesByTurn(messages, { isSessionProcessing: true })
      const turn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(turn)).toBe('awaiting')
    })

    it('only tool + session done + no text → phase complete, no response promoted', () => {
      resetCounters()
      turnIdCounter++

      const messages: Message[] = [
        createUserMessage('do the thing'),
        createToolMessage('completed', 'Bash'),
      ]
      const turns = groupMessagesByTurn(messages, { isSessionProcessing: false })
      const turn = getLastAssistantTurn(turns)!
      expect(deriveTurnPhase(turn)).toBe('complete')
      expect(turn.response).toBeUndefined()
    })

    it('omitting the option keeps current behavior (backwards compat)', () => {
      resetCounters()
      turnIdCounter++

      const messages: Message[] = [
        createUserMessage('do the thing'),
        createAssistantMessage(false, true),
        createToolMessage('completed', 'Bash'),
      ]
      const turns = groupMessagesByTurn(messages) // no second arg
      const turn = getLastAssistantTurn(turns)!
      // Without the explicit signal, the turn stays open — pre-fix behavior preserved
      expect(deriveTurnPhase(turn)).toBe('awaiting')
    })
  })
})

describe('edge cases', () => {
  it('empty activities array returns pending', () => {
    resetCounters()

    const turn: AssistantTurn = {
      type: 'assistant',
      turnId: 'test',
      activities: [],
      isStreaming: false,
      isComplete: false,
      timestamp: Date.now(),
    }
    expect(deriveTurnPhase(turn)).toBe('pending')
  })

  it('isComplete true with empty activities returns complete', () => {
    const turn: AssistantTurn = {
      type: 'assistant',
      turnId: 'test',
      activities: [],
      isStreaming: false,
      isComplete: true,
      timestamp: Date.now(),
    }
    expect(deriveTurnPhase(turn)).toBe('complete')
  })

  it('response with isStreaming false but isComplete false returns awaiting', () => {
    // This is an edge case - usually when response.isStreaming is false,
    // the turn should be marked complete. But we trust isComplete as
    // the authoritative signal.
    const turn: AssistantTurn = {
      type: 'assistant',
      turnId: 'test',
      activities: [
        {
          id: 'act-1',
          type: 'tool',
          status: 'completed',
          timestamp: Date.now(),
        },
      ],
      response: {
        text: 'Done',
        isStreaming: false,
      },
      isStreaming: false,
      isComplete: false, // Not yet marked complete
      timestamp: Date.now(),
    }
    // Per our priority: complete > streaming > tool_active > awaiting > pending
    // response.isStreaming is false, so not streaming
    // no running tools, so not tool_active
    // has activities, so awaiting
    expect(deriveTurnPhase(turn)).toBe('awaiting')
  })
})

describe('hidden messages', () => {
  it('never render as a turn but the assistant reply they trigger still does', () => {
    resetCounters()

    // A hidden system-generated nudge (e.g. WS2 background-task-completion) followed
    // by the assistant response it drives.
    const hiddenNudge: Message = { ...createUserMessage('[background-task-completed] present it'), hidden: true }
    const reply = createAssistantMessage(false, false, 'turn-reply')

    const turns = groupMessagesByTurn([hiddenNudge, reply])

    // Exactly one turn — the assistant reply. No 'user' turn for the hidden nudge.
    expect(turns.some(t => t.type === 'user')).toBe(false)
    const assistantTurns = turns.filter(t => t.type === 'assistant')
    expect(assistantTurns.length).toBe(1)
  })

  it('a visible user message still renders normally alongside a hidden one', () => {
    resetCounters()

    const visible = createUserMessage('real user question')
    const hidden: Message = { ...createUserMessage('[background-task-completed] hidden'), hidden: true }

    const turns = groupMessagesByTurn([visible, hidden])

    const userTurns = turns.filter(t => t.type === 'user')
    expect(userTurns.length).toBe(1)
    expect((userTurns[0] as { message: Message }).message.content).toBe('real user question')
  })
})

describe('pending follow-up replies', () => {
  it('keeps a pending reply as the response after tools, not a thought row', () => {
    resetCounters()
    const user = createUserMessage('查看结构')
    const tool = createToolMessage('completed', 'Read')
    tool.timestamp = user.timestamp + 5
    const pending: Message = {
      id: 'pending-reply',
      role: 'assistant',
      content: '报告分为三部分',
      timestamp: user.timestamp + 10,
      isStreaming: true,
      isPending: true,
    }

    const turns = groupMessagesByTurn([user, tool, pending])
    const assistant = turns[1]
    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.activities).toHaveLength(1)
      expect(assistant.response?.text).toBe('报告分为三部分')
      expect(assistant.response?.isStreaming).toBe(true)
    }
  })

  it('keeps a pending reply as the response when only intermediate thought exists', () => {
    resetCounters()
    const user = createUserMessage('用html')
    const thought: Message = {
      id: 'thought',
      role: 'assistant',
      content: '先整理章节',
      timestamp: user.timestamp + 5,
      isIntermediate: true,
    }
    const pending: Message = {
      id: 'pending-reply',
      role: 'assistant',
      content: '<table>',
      timestamp: user.timestamp + 10,
      isStreaming: true,
      isPending: true,
    }

    const turns = groupMessagesByTurn([user, thought, pending])
    const assistant = turns[1]
    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.activities.map(activity => activity.content)).toEqual(['先整理章节'])
      expect(assistant.response?.text).toBe('<table>')
      expect(assistant.response?.isStreaming).toBe(true)
    }
  })

  it('shows pending text after a user message as a streaming response, not a thought row', () => {
    resetCounters()
    const user = createUserMessage('请使用列表展示')
    const pending: Message = {
      id: 'pending-reply',
      role: 'assistant',
      content: '好的，下面列出文稿的所有章节及其子项：',
      timestamp: user.timestamp + 10,
      isStreaming: true,
      isPending: true,
    }

    const turns = groupMessagesByTurn([user, pending])
    expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant'])
    const assistant = turns[1]
    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.activities).toEqual([])
      expect(assistant.response?.text).toBe('好的，下面列出文稿的所有章节及其子项：')
      expect(assistant.response?.isStreaming).toBe(true)
      expect(shouldShowStreamingFooter({
        isStreaming: assistant.response.isStreaming,
        hasToolActivities: assistant.activities.some(activity => activity.type === 'tool'),
      })).toBe(true)
    }
  })

  it('keeps a finished swarm preamble streaming on the card but hides the footer once spawn_session starts (#203)', () => {
    resetCounters()
    const user = createUserMessage('同时调研三个独立模型')
    const preamble: Message = {
      id: 'preamble',
      role: 'assistant',
      content: '好的，我将启动三个子代理并行调研这三个模型的最新信息。',
      timestamp: user.timestamp + 10,
      isStreaming: true,
      isPending: true,
    }
    const spawn = createToolMessage('running', 'spawn_session')
    spawn.timestamp = user.timestamp + 20

    const turns = groupMessagesByTurn([user, preamble, spawn])
    const assistant = turns[1]
    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.response?.text).toBe('好的，我将启动三个子代理并行调研这三个模型的最新信息。')
      expect(assistant.response?.isStreaming).toBe(true)
      expect(assistant.activities.some(activity => activity.type === 'tool')).toBe(true)
      expect(shouldShowStreamingFooter({
        isStreaming: assistant.response.isStreaming,
        hasToolActivities: true,
      })).toBe(false)
    }
  })

  it('keeps the completed dispatch response open while managed Swarm workers are running (#224)', () => {
    resetCounters()
    const user = createUserMessage('同时调研三个独立模型')
    const spawn = createToolMessage('completed', 'session__spawn_session')
    spawn.timestamp = user.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'started',
      spawnReason: 'automatic',
      lifecycle: 'managed',
    })
    spawn.toolResult = spawn.content
    const dispatched: Message = {
      id: 'dispatch-complete',
      role: 'assistant',
      content: '已成功启动 3 个子代理并行调研。',
      timestamp: user.timestamp + 20,
      isStreaming: false,
      isPending: false,
    }

    const turns = groupMessagesByTurn([user, spawn, dispatched], {
      isSessionProcessing: false,
      isManagedSwarmRunning: true,
    })
    const assistant = turns[1]

    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.isComplete).toBe(false)
      expect(assistant.isStreaming).toBe(true)
      expect(assistant.response?.isStreaming).toBe(false)
      expect(shouldShowStreamingFooter({
        isStreaming: assistant.response?.isStreaming ?? false,
        hasToolActivities: true,
      })).toBe(false)
    }
  })

  it('restores completed chrome after the managed Swarm settles (#224)', () => {
    resetCounters()
    const user = createUserMessage('同时调研三个独立模型')
    const spawn = createToolMessage('completed', 'mcp__session__spawn_session')
    spawn.timestamp = user.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'started',
      spawnReason: 'automatic',
      lifecycle: 'managed',
    })
    spawn.toolResult = spawn.content
    const final: Message = {
      id: 'swarm-final',
      role: 'assistant',
      content: '三个子代理均已完成，以下是汇总结论。',
      timestamp: user.timestamp + 20,
      isStreaming: false,
      isPending: false,
    }

    const turns = groupMessagesByTurn([user, spawn, final], {
      isSessionProcessing: false,
      isManagedSwarmRunning: false,
    })
    const assistant = turns[1]

    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.isComplete).toBe(true)
      expect(assistant.isStreaming).toBe(false)
      expect(assistant.response?.isStreaming).toBe(false)
    }
  })

  it('does not hold a third-party spawn_session tool open (#224)', () => {
    resetCounters()
    const user = createUserMessage('调用第三方会话工具')
    const spawn = createToolMessage('completed', 'mcp__vendor__spawn_session')
    spawn.timestamp = user.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'started',
      spawnReason: 'automatic',
      lifecycle: 'managed',
    })
    spawn.toolResult = spawn.content
    const response: Message = {
      id: 'vendor-complete',
      role: 'assistant',
      content: '第三方工具调用完成。',
      timestamp: user.timestamp + 20,
      isStreaming: false,
      isPending: false,
    }

    const turns = groupMessagesByTurn([user, spawn, response], {
      isSessionProcessing: false,
      isManagedSwarmRunning: true,
    })
    const assistant = turns[1]

    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.isComplete).toBe(true)
      expect(assistant.isStreaming).toBe(false)
    }
  })

  it('does not hold an explicit background delegation open while Swarm status is running (#224)', () => {
    resetCounters()
    const user = createUserMessage('/delegate 后台检查日志')
    const spawn = createToolMessage('completed', 'spawn_session')
    spawn.timestamp = user.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'started',
      spawnReason: 'user-requested',
      lifecycle: 'managed',
    })
    spawn.toolResult = spawn.content
    const delegated: Message = {
      id: 'delegate-complete',
      role: 'assistant',
      content: '后台任务已经启动。',
      timestamp: user.timestamp + 20,
      isStreaming: false,
      isPending: false,
    }

    const turns = groupMessagesByTurn([user, spawn, delegated], {
      isSessionProcessing: false,
      isManagedSwarmRunning: true,
    })
    const assistant = turns[1]

    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.isComplete).toBe(true)
      expect(assistant.response?.isStreaming).toBe(false)
    }
  })

  it('does not hold an automatic detached worker open (#224)', () => {
    resetCounters()
    const user = createUserMessage('后台启动独立 worker')
    const spawn = createToolMessage('completed', 'spawn_session')
    spawn.timestamp = user.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'started',
      spawnReason: 'automatic',
      lifecycle: 'detached',
    })
    spawn.toolResult = spawn.content
    const response: Message = {
      id: 'detached-complete',
      role: 'assistant',
      content: '独立 worker 已在后台启动。',
      timestamp: user.timestamp + 20,
      isStreaming: false,
      isPending: false,
    }

    const turns = groupMessagesByTurn([user, spawn, response], {
      isSessionProcessing: false,
      isManagedSwarmRunning: true,
    })
    const assistant = turns[1]

    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.isComplete).toBe(true)
      expect(assistant.response?.isStreaming).toBe(false)
    }
  })

  it('keeps a timed-out managed wait child open when it continues in background (#224)', () => {
    resetCounters()
    const user = createUserMessage('等待子代理调研')
    const spawn = createToolMessage('completed', 'spawn_session')
    spawn.timestamp = user.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'timeout',
      spawnReason: 'automatic',
      lifecycle: 'managed',
      mode: 'wait',
    })
    spawn.toolResult = spawn.content
    const response: Message = {
      id: 'wait-timeout',
      role: 'assistant',
      content: '子代理仍在后台继续。',
      timestamp: user.timestamp + 20,
      isStreaming: false,
      isPending: false,
    }

    const turns = groupMessagesByTurn([user, spawn, response], {
      isSessionProcessing: false,
      isManagedSwarmRunning: true,
    })
    const assistant = turns[1]

    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.isComplete).toBe(false)
      expect(assistant.isStreaming).toBe(true)
      expect(assistant.response?.isStreaming).toBe(false)
    }
  })

  it('merges the hidden Swarm aggregation into the original visible turn (#224)', () => {
    resetCounters()
    const user = createUserMessage('同时调研三个独立模型')
    const spawn = createToolMessage('completed', 'spawn_session')
    spawn.timestamp = user.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'started',
      spawnReason: 'automatic',
      lifecycle: 'managed',
      mode: 'background',
    })
    spawn.toolResult = spawn.content
    const dispatch: Message = {
      id: 'dispatch-response',
      role: 'assistant',
      content: '已启动三个子代理。',
      timestamp: user.timestamp + 20,
      isStreaming: false,
    }
    const hiddenNudge: Message = {
      id: 'managed-swarm-nudge',
      role: 'user',
      content: '[managed-swarm-settled]',
      timestamp: user.timestamp + 30,
      hidden: true,
    }
    const aggregation: Message = {
      id: 'aggregation-response',
      role: 'assistant',
      content: '三个子代理均已完成，以下是汇总结论。',
      timestamp: user.timestamp + 40,
      isStreaming: false,
    }

    const turns = groupMessagesByTurn([user, spawn, dispatch, hiddenNudge, aggregation], {
      isSessionProcessing: false,
      isManagedSwarmRunning: false,
    })
    const assistantTurns = turns.filter((turn): turn is AssistantTurn => turn.type === 'assistant')

    expect(assistantTurns).toHaveLength(1)
    expect(assistantTurns[0]?.isComplete).toBe(true)
    expect(assistantTurns[0]?.response?.text).toBe(aggregation.content)
    expect(assistantTurns[0]?.activities.some(activity => activity.toolName === 'spawn_session')).toBe(true)
  })

  it('does not reopen an older Swarm turn after a new visible user message (#224)', () => {
    resetCounters()
    const firstUser = createUserMessage('并行调研')
    const spawn = createToolMessage('completed', 'spawn_session')
    spawn.timestamp = firstUser.timestamp + 10
    spawn.content = JSON.stringify({
      status: 'started',
      spawnReason: 'automatic',
      lifecycle: 'managed',
      mode: 'background',
    })
    spawn.toolResult = spawn.content
    const dispatch: Message = {
      id: 'older-dispatch',
      role: 'assistant',
      content: '子代理已经启动。',
      timestamp: firstUser.timestamp + 20,
      isStreaming: false,
    }
    const secondUser: Message = {
      ...createUserMessage('顺便回答另一个问题'),
      timestamp: firstUser.timestamp + 30,
    }

    const turns = groupMessagesByTurn([firstUser, spawn, dispatch, secondUser], {
      isSessionProcessing: true,
      isManagedSwarmRunning: true,
    })
    const assistant = turns.find((turn): turn is AssistantTurn => turn.type === 'assistant')

    expect(turns.at(-1)?.type).toBe('user')
    expect(assistant?.isComplete).toBe(true)
    expect(assistant?.isStreaming).toBe(false)
  })
})

describe('queued messages', () => {
  it('keeps queued user content out of the transcript until replay starts', () => {
    resetCounters()

    const activeUser = createUserMessage('current task')
    const queuedUser: Message = {
      ...createUserMessage('later task'),
      isQueued: true,
    }

    const turns = groupMessagesByTurn([activeUser, queuedUser])
    const userTurns = turns.filter(turn => turn.type === 'user')

    expect(userTurns).toHaveLength(1)
    expect((userTurns[0] as { message: Message }).message.content).toBe('current task')
  })

  it('keeps a replayed user message as a hard boundary even when turn ids are reused', () => {
    resetCounters()

    const firstUser = createUserMessage('first')
    const firstTool = createToolMessage('completed', 'Read', 'shared-turn')
    const replayedUser = createUserMessage('send now')
    const replayedTool = createToolMessage('completed', 'Read', 'shared-turn')
    firstUser.timestamp = 1
    firstTool.timestamp = 2
    replayedUser.timestamp = 3
    replayedTool.timestamp = 4

    const turns = groupMessagesByTurn([firstUser, firstTool, replayedUser, replayedTool])
    const assistantTurns = turns.filter(turn => turn.type === 'assistant')

    expect(turns.map(turn => turn.type)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(assistantTurns.map(turn => turn.activities.length)).toEqual([1, 1])
  })
})
