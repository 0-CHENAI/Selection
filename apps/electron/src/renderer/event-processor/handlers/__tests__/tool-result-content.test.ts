import { describe, expect, it } from 'bun:test'
import { handleToolResult } from '../tool'
import type { SessionState, ToolResultEvent } from '../../types'

function emptyState(): SessionState {
  return {
    session: {
      id: 'session-tool-image',
      workspaceId: 'workspace-tool-image',
      workspaceName: 'Workspace',
      lastMessageAt: 0,
      messages: [],
      isProcessing: true,
    },
    streaming: null,
  }
}

describe('tool result multimodal content', () => {
  it('keeps image blocks on the live runtime message', () => {
    const event: ToolResultEvent = {
      type: 'tool_result',
      sessionId: 'session-tool-image',
      toolUseId: 'tool-preview',
      toolName: 'Read',
      result: '{"artifacts":[{"path":"data/preview/preview.png"}]}',
      content: [
        { type: 'text', text: '{"artifacts":[{"path":"data/preview/preview.png"}]}' },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
      ],
      isError: false,
    }

    const next = handleToolResult(emptyState(), event)
    const replaced = handleToolResult(next, {
      ...event,
      result: '{"ok":false}',
      content: undefined,
      isError: true,
    })

    expect(next.session.messages[0]?.toolResultContent).toEqual(event.content)
    expect(next.session.messages[0]?.toolResult).not.toContain('aW1hZ2U=')
    expect(replaced.session.messages[0]?.toolResultContent).toBeUndefined()
    expect(replaced.session.messages[0]?.toolResult).toBe('{"ok":false}')
  })

  it('replaces a password fill input when the result carries a redacted copy', () => {
    const state = handleToolResult({
      ...emptyState(),
      session: {
        ...emptyState().session,
        messages: [{
          id: 'tool-1',
          role: 'tool',
          content: '',
          timestamp: 1,
          toolUseId: 'tool-fill',
          toolName: 'browser_tool',
          toolInput: { command: 'fill @e2 hunter2' },
          toolStatus: 'executing',
        }],
      },
    }, {
      type: 'tool_result',
      sessionId: 'session-tool-image',
      toolUseId: 'tool-fill',
      toolName: 'browser_tool',
      result: 'Filled password field @e2 (7 characters)',
      toolInput: { command: 'fill @e2 [password: 7 characters]' },
    })

    expect(state.session.messages[0]?.toolInput).toEqual({ command: 'fill @e2 [password: 7 characters]' })
    expect(JSON.stringify(state.session.messages)).not.toContain('hunter2')
  })
})

describe('saved stdout does not turn failed execution into success', () => {
  it.each([false, true])('honors an explicit error with an existing row=%s', existing => {
    const state = emptyState()
    if (existing) state.session.messages.push({ id: 'bash', role: 'tool', timestamp: 1, content: '', toolUseId: 'bash', toolName: 'Bash', toolStatus: 'executing' })
    const result = handleToolResult(state, { type: 'tool_result', sessionId: state.session.id, toolUseId: 'bash', toolName: 'Bash',
      result: 'Full output saved to /tmp/full.log\nCommand exited with code 7', isError: true })
    expect(result.session.messages[0]).toMatchObject({ toolStatus: 'error', isError: true })
  })
})


it('honors host success for quoted error text and keeps the legacy missing-flag fallback', () => {
  const state = emptyState();
  const event: ToolResultEvent = { type: 'tool_result', sessionId: state.session.id, toolUseId: 'read', toolName: 'Read', result: '[ERROR] quoted log line' };
  expect(handleToolResult(state, { ...event, isError: false }).session.messages[0]?.toolStatus).toBe('completed');
  expect(handleToolResult(state, event).session.messages[0]?.toolStatus).toBe('error');
});
