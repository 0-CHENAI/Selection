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
      toolName: 'office_document_preview',
      result: '{"artifacts":[{"path":"data/office/preview.png"}]}',
      content: [
        { type: 'text', text: '{"artifacts":[{"path":"data/office/preview.png"}]}' },
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
})
