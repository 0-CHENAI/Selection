import { describe, expect, it } from 'bun:test'
import { createManagedSession, SessionManager } from './SessionManager.ts'

describe('SessionManager text stream phases (#87)', () => {
  function setupSession(id: string) {
    const manager = new SessionManager()
    const managed = createManagedSession(
      { id },
      { id: 'workspace-1', name: 'Workspace', rootPath: '/tmp/text-stream-phase' } as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    managed.messages = [{ id: 'user-1', role: 'user', content: '检查项目', timestamp: 1 }]
    ;(manager as any).sessions.set(managed.id, managed)
    ;(manager as any).persistSession = () => {}
    const events: any[] = []
    manager.setEventSink((_channel, _target, event) => events.push(event))
    return { manager, managed, events }
  }

  it('persists a dangling stream as intermediate when processing stops', async () => {
    const { manager, managed, events } = setupSession('session-text-phase')

    await (manager as any).processEvent(managed, {
      type: 'text_delta',
      text: '我先读取相关文件。',
      phase: 'unclassified',
      turnId: 'message-1',
    })
    await (manager as any).processEvent(managed, {
      type: 'error',
      message: '读取失败',
    })
    await (manager as any).onProcessingStopped(
      managed.id,
      'error',
      managed.processingGeneration,
    )

    const partial = managed.messages.find((message) => message.role === 'assistant')
    const failure = managed.messages.find((message) => message.role === 'error')
    expect(partial).toMatchObject({
      role: 'assistant',
      content: '我先读取相关文件。',
      isIntermediate: true,
      turnId: 'message-1',
    })
    expect(partial!.timestamp).toBeLessThan(failure!.timestamp)
    expect(events.find((event) => event.type === 'text_complete')).toMatchObject({
      text: '我先读取相关文件。',
      isIntermediate: true,
      turnId: 'message-1',
      messageId: partial?.id,
      timestamp: partial?.timestamp,
    })
    expect(events.find((event) => event.type === 'text_delta')).toMatchObject({
      delta: '我先读取相关文件。',
      phase: 'unclassified',
      turnId: 'message-1',
    })
    expect(managed.streamingText).toBe('')
  })

  it('flushes a delta batch before its phase changes', async () => {
    const { manager, managed, events } = setupSession('session-phase-boundary')

    ;(manager as any).queueDelta(
      managed.id, managed.workspace.id, '先检查文件。', 'intermediate', 'message-1',
    )
    ;(manager as any).queueDelta(
      managed.id, managed.workspace.id, '最终结论。', 'final', 'message-2',
    )
    ;(manager as any).flushDelta(managed.id, managed.workspace.id)

    expect(events.filter((event) => event.type === 'text_delta')).toMatchObject([
      { delta: '先检查文件。', phase: 'intermediate', turnId: 'message-1' },
      { delta: '最终结论。', phase: 'final', turnId: 'message-2' },
    ])
  })
})
