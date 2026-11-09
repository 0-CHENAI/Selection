import { expect, test } from 'bun:test'
import { PiEventAdapter } from '../../../../../../../packages/shared/src/agent/backend/pi/event-adapter'
import { messageToStored } from '../../../../../../../packages/core/src/types/message-mapper'
import { handleToolStart, handleToolProgress, handleToolResult } from '../tool'
import { handleInterrupted, handleStatus } from '../session'
import type { SessionState } from '../../types'

const empty = (): SessionState => ({ session: { id: 's', workspaceId: 'w', workspaceName: 'W', lastMessageAt: 0, messages: [], isProcessing: true }, streaming: null })

test('Bash progress travels from SDK snapshots into one work-chain row and clears on completion', () => {
  const adapter = new PiEventAdapter(); adapter.startTurn()
  const start = [...adapter.adaptEvent({ type: 'tool_execution_start', toolCallId: 'bash', toolName: 'bash', args: { command: 'echo x' } } as never)][0]!
  let state = handleToolStart(empty(), { ...start, sessionId: 's' } as never)
  const update = (partialResult: unknown) => [...adapter.adaptEvent({ type: 'tool_execution_update', toolCallId: 'bash', partialResult } as never)]
  const activity = update({ content: [{ type: 'text', text: 'SECRET OUTPUT' }] })[0]!
  expect(JSON.stringify(activity)).not.toContain('SECRET')
  state = handleToolProgress(state, { ...activity, sessionId: 's' } as never)
  expect(state.session.messages[0]!.toolProgress?.outputBytes).toBe(13)
  const processing = update({ content: [], details: { selectionToolProgress: { phase: 'processing_result', executionMs: 100 } } })[0]!
  state = handleToolProgress(state, { ...processing, sessionId: 's' } as never)
  expect(state.session.messages).toHaveLength(1)
  expect(state.session.messages[0]!.toolStatus).toBe('executing')
  expect(state.session.messages[0]!.toolProgress?.phase).toBe('processing_result')
  expect(messageToStored(state.session.messages[0]!)).not.toHaveProperty('toolProgress')
  expect(handleToolProgress(state, { ...activity, sessionId: 's' } as never)).toBe(state)
  const end = [...adapter.adaptEvent({ type: 'tool_execution_end', toolCallId: 'bash', toolName: 'bash', isError: true,
    result: { content: [{ type: 'text', text: 'exit 7' }], details: { selectionExecutionOutcome: 'unknown' } } } as never)][0]!
  expect(end).toMatchObject({ type: 'tool_result', executionOutcome: 'unknown', result: 'exit 7', isError: true })
  state = handleToolResult(state, { ...end, sessionId: 's' } as never)
  expect(state.session.messages[0]!.toolStatus).toBe('error')
  expect(state.session.messages[0]!.toolProgress).toBeUndefined()
  expect(handleToolProgress(state, { ...processing, sessionId: 's' } as never)).toBe(state)
})

test('stop clears temporary tool progress and late progress cannot resurrect it', () => {
  let state = handleToolStart(empty(), { type: 'tool_start', sessionId: 's', toolUseId: 'bash', toolName: 'Bash', toolInput: {} })
  const event = { type: 'tool_progress' as const, sessionId: 's', toolUseId: 'bash', progress: { phase: 'running' as const, at: 1 } }
  state = handleToolProgress(state, event)
  state = handleInterrupted(state, { type: 'interrupted', sessionId: 's', message: { id: 'stop', role: 'info', content: 'Stopped', timestamp: 1 } }).state
  expect(state.session.messages[0]!.toolProgress).toBeUndefined()
  expect(handleToolProgress(state, event)).toBe(state)
})

test('long tool argument generation emits actual activity without leaking unfinished code or creating transcript fragments', () => {
  const adapter = new PiEventAdapter(); adapter.startTurn()
  const events = [...adapter.adaptEvent({ type: 'message_update', assistantMessageEvent: {
    type: 'toolcall_delta', contentIndex: 0, delta: 'SECRET CODE', partial: { role: 'assistant', content: [{ type: 'toolCall', id: 'write', name: 'write', arguments: {} }] },
  } } as never)]
  expect(events.some(e => e.type === 'model_activity' && e.toolInputBytes === 11)).toBe(true)
  expect(events.some(e => e.type === 'tool_start')).toBe(false)
  expect(JSON.stringify(events)).not.toContain('SECRET CODE')
  let state = empty()
  const status = events.find(e => e.type === 'status')!
  state = handleStatus(state, { ...status, sessionId: 's' } as never).state
  expect(state.session.currentStatus?.statusType).toBe('tool_arguments')
  expect(state.session.messages).toHaveLength(0)
  const finished = [...adapter.adaptEvent({ type: 'agent_end', messages: [] } as never)].find(e => e.type === 'status')!
  state = handleStatus(state, { ...finished, sessionId: 's' } as never).state
  expect(state.session.currentStatus).toBeUndefined()
})
