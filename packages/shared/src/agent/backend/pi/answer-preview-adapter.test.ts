import { expect, it } from 'bun:test'
import { PiEventAdapter } from './event-adapter'

it('forwards decoded submit arguments before execution and flushes the final snapshot', () => {
  const adapter = new PiEventAdapter()
  adapter.startTurn()
  const tool = { type: 'toolCall', id: 'submit', name: 'mcp__session__submit_answer', arguments: {} }
  const partial = { role: 'assistant', content: [tool] }
  const events = [...adapter.adaptEvent({ type: 'message_update', assistantMessageEvent: {
    type: 'toolcall_delta', contentIndex: 0, partial, delta: '{"markdown":"# Hello\\n',
  } } as never)]
  expect(events).toEqual([{ type: 'answer_preview', toolCallId: 'submit', text: '# Hello\n' }])
  const final = [...adapter.adaptEvent({ type: 'message_update', assistantMessageEvent: {
    type: 'toolcall_end', contentIndex: 0, partial, toolCall: { ...tool, arguments: { markdown: '# Hello\nWorld' } },
  } } as never)]
  expect(final).toEqual([{ type: 'answer_preview', toolCallId: 'submit', text: '# Hello\nWorld' }])
  const other = [...adapter.adaptEvent({ type: 'message_update', assistantMessageEvent: {
    type: 'toolcall_delta', contentIndex: 0, partial: { ...partial, content: [{ ...tool, name: 'Bash' }] }, delta: '{"command":"not Markdown"}',
  } } as never)]
  expect(other).toEqual([])
})
