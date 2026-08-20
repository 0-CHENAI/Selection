import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('message queue management (#22)', () => {
  let manager: SessionManager
  let managed: ReturnType<typeof createManagedSession>
  let events: any[]

  beforeEach(() => {
    manager = new SessionManager()
    managed = createManagedSession(
      { id: 'session-queue', name: 'Queue test' },
      { id: 'workspace', name: 'Workspace', rootPath: '/tmp/queue-test' } as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    managed.messages = [
      { id: 'current', role: 'user', content: 'current task', timestamp: 1 },
      {
        id: 'queue-a',
        role: 'user',
        content: 'first queued',
        timestamp: 2,
        isQueued: true,
        attachments: [{
          id: 'attachment-a',
          type: 'text',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 10,
          storedPath: '/tmp/notes.txt',
        }],
        badges: [{ type: 'skill', label: 'Review', rawText: '@review', start: 0, end: 7 }],
        queuedSkillSlugs: ['workspace:review'],
        queuedContext: {
          sourceSlugs: ['knowledge'],
          model: 'model-a',
          llmConnection: 'connection-a',
          thinkingLevel: 'high',
          permissionMode: 'allow-all',
        },
      },
      { id: 'queue-b', role: 'user', content: 'second queued', timestamp: 3, isQueued: true },
    ]
    managed.messageQueue = [
      {
        message: 'first queued',
        messageId: 'queue-a',
        storedAttachments: managed.messages[1]!.attachments,
        options: {
          badges: managed.messages[1]!.badges,
          skillSlugs: ['workspace:review'],
          queueContext: managed.messages[1]!.queuedContext,
        },
      },
      { message: 'second queued', messageId: 'queue-b' },
    ]

    ;(manager as any).sessions.set(managed.id, managed)
    ;(manager as any).persistSession = () => {}
    ;(manager as any).flushSession = async () => {}
    events = []
    manager.setEventSink((_channel, _target, event) => events.push(event))
  })

  it('edits content without dropping attachments, badges, or skills', async () => {
    await manager.updateQueuedMessage(managed.id, 'queue-a', 'edited queued content')

    expect(managed.messageQueue[0]?.message).toBe('edited queued content')
    expect(managed.messageQueue[0]?.storedAttachments).toHaveLength(1)
    expect(managed.messageQueue[0]?.options?.badges).toHaveLength(1)
    expect(managed.messageQueue[0]?.options?.skillSlugs).toEqual(['workspace:review'])
    expect(managed.messageQueue[0]?.options?.queueContext).toEqual(managed.messages[1]?.queuedContext)
    expect(managed.messages[1]?.content).toBe('edited queued content')
    expect(events.at(-1)).toMatchObject({
      type: 'queue_changed',
      messages: [
        { id: 'queue-a', content: 'edited queued content' },
        { id: 'queue-b' },
      ],
    })
  })

  it('reorders every visible queue item without changing formal messages', async () => {
    await manager.reorderQueuedMessages(managed.id, ['queue-b', 'queue-a'])

    expect(managed.messageQueue.map(item => item.messageId)).toEqual(['queue-b', 'queue-a'])
    expect(managed.messages.map(message => message.id)).toEqual(['current', 'queue-b', 'queue-a'])
    expect(events.at(-1)?.messages.map((message: any) => message.id)).toEqual(['queue-b', 'queue-a'])
  })

  it('deletes exactly one queued item', async () => {
    await manager.deleteQueuedMessage(managed.id, 'queue-a')

    expect(managed.messageQueue.map(item => item.messageId)).toEqual(['queue-b'])
    expect(managed.messages.map(message => message.id)).toEqual(['current', 'queue-b'])
    expect(events.at(-1)?.messages.map((message: any) => message.id)).toEqual(['queue-b'])
  })

  it('does not abort a live turn for a hidden system nudge', async () => {
    const forceAbort = mock(() => {})
    managed.agent = {
      isProcessing: () => true,
      forceAbort,
    } as never

    await manager.sendMessage(managed.id, 'hidden nudge', undefined, undefined, { hidden: true })

    expect(forceAbort).not.toHaveBeenCalled()
    expect(managed.stopRequested).toBeFalsy()
    expect(managed.wasInterrupted).toBeUndefined()
    expect(managed.messages.find(message => message.content === 'hidden nudge')).toMatchObject({
      hidden: true,
      isQueued: true,
    })
    expect(managed.messageQueue.some(item => item.message === 'hidden nudge')).toBe(true)
  })

  it('aborts the live turn when send-now cannot native-steer', async () => {
    const forceAbort = mock(() => {})
    const redirect = mock(() => {
      forceAbort()
      return false
    })
    managed.agent = {
      isProcessing: () => true,
      canRedirect: () => false,
      redirect,
      forceAbort,
    } as never

    await manager.sendQueuedMessageNow(managed.id, 'queue-b')

    expect(redirect).not.toHaveBeenCalled()
    expect(forceAbort).toHaveBeenCalled()
    expect(managed.stopRequested).toBe(true)
    expect(managed.wasInterrupted).toBe(true)
    expect(managed.messageQueue.map(item => item.messageId)).toEqual(['queue-b', 'queue-a'])
    expect(managed.messages.find(message => message.id === 'queue-b')).toMatchObject({
      isQueued: false,
      hidden: false,
    })
    expect(managed.messages.some(message => message.id === 'current')).toBe(true)
  })

  it('keeps intermediate thought visible when aborting a live text stream', async () => {
    const redirect = mock(() => true)
    const forceAbort = mock(() => {})
    managed.messages.splice(1, 0, {
      id: 'thought-step',
      role: 'assistant',
      content: '先读目录',
      timestamp: 1.4,
      isPending: true,
      isIntermediate: true,
      turnId: 'live-turn',
    }, {
      id: 'live-answer',
      role: 'assistant',
      content: 'partial answer',
      timestamp: 1.5,
      isStreaming: true,
      isPending: true,
      turnId: 'live-turn',
    })
    managed.agent = {
      isProcessing: () => true,
      canRedirect: () => true,
      redirect,
      forceAbort,
    } as never

    await manager.sendQueuedMessageNow(managed.id, 'queue-b')

    expect(redirect).not.toHaveBeenCalled()
    expect(forceAbort).toHaveBeenCalled()
    expect(managed.messages.find(message => message.id === 'live-answer')?.hidden).toBe(true)
    expect(managed.messages.find(message => message.id === 'thought-step')).toMatchObject({
      hidden: false,
      content: '先读目录',
      isIntermediate: true,
    })
    const followUp = managed.messages.find(message => message.id === 'queue-b')
    const thought = managed.messages.find(message => message.id === 'thought-step')
    expect(followUp?.timestamp).toBeGreaterThan(1)
    expect(thought?.timestamp).toBeGreaterThan(followUp?.timestamp ?? 0)
  })

  it('aborts a live text stream and keeps the follow-up queued for replay', async () => {
    const redirect = mock(() => true)
    const forceAbort = mock(() => {})
    managed.messages.splice(1, 0, {
      id: 'live-answer',
      role: 'assistant',
      content: 'partial answer',
      timestamp: 1.5,
      isStreaming: true,
      isPending: true,
      turnId: 'live-turn',
    })
    managed.agent = {
      isProcessing: () => true,
      canRedirect: () => true,
      redirect,
      forceAbort,
    } as never

    await manager.sendQueuedMessageNow(managed.id, 'queue-b')

    expect(redirect).not.toHaveBeenCalled()
    expect(forceAbort).toHaveBeenCalled()
    expect(managed.stopRequested).toBe(true)
    expect(managed.wasInterrupted).toBe(true)
    expect(managed.messageQueue.map(item => item.messageId)).toEqual(['queue-b', 'queue-a'])
    expect(managed.messages.find(message => message.id === 'live-answer')).toMatchObject({
      hidden: true,
      isStreaming: false,
      turnId: 'closed-before-steer:live-answer',
    })
    expect(managed.messages.find(message => message.id === 'queue-b')).toMatchObject({
      id: 'queue-b',
      content: 'second queued',
      isQueued: false,
    })
    expect(managed.messages.find(message => message.id === 'queue-b')?.hidden).toBe(false)
    expect(events.slice(-2).map(event => event.type)).toEqual(['user_message', 'queue_changed'])
    expect(events.at(-2)).toMatchObject({
      type: 'user_message',
      status: 'accepted',
      message: { id: 'queue-b', isQueued: false },
    })
    expect(events.at(-1)?.messages.map((message: any) => message.id)).toEqual(['queue-a'])
  })

  it('keeps an accepted send-now follow-up when the user stops', async () => {
    await manager.sendQueuedMessageNow(managed.id, 'queue-b')
    events.length = 0
    await manager.cancelProcessing(managed.id)

    expect(managed.messageQueue).toEqual([])
    expect(managed.messages.find(message => message.id === 'queue-b')).toMatchObject({
      content: 'second queued',
      isQueued: false,
      hidden: false,
    })
    expect(managed.messages.some(message => message.id === 'queue-a')).toBe(false)
    expect(events.find(event => event.type === 'interrupted')?.queuedMessages).toEqual(['first queued'])
  })

  it('discards hidden queued continuations on Stop without restoring them to the draft', async () => {
    managed.messages.push({
      id: 'hidden-retry',
      role: 'user',
      content: 'current task\n\n[bid-playbook activated]',
      timestamp: 4,
      isQueued: true,
      hidden: true,
    })
    managed.messageQueue.push({
      message: 'current task\n\n[bid-playbook activated]',
      messageId: 'hidden-retry',
      options: { hidden: true },
    })

    await manager.cancelProcessing(managed.id)

    expect(managed.messages.some(message => message.id === 'hidden-retry')).toBe(false)
    expect(events.find(event => event.type === 'interrupted')?.queuedMessages).toEqual([
      'first queued',
      'second queued',
    ])
  })

  it('aborts a live tool turn so send-now changes direction instead of finishing both answers', async () => {
    const redirect = mock(() => true)
    const forceAbort = mock(() => {})
    managed.messages.splice(1, 0,
      {
        id: 'live-answer',
        role: 'assistant',
        content: 'partial answer',
        timestamp: 1.5,
        isStreaming: true,
        isPending: true,
        turnId: 'live-turn',
      },
      {
        id: 'live-tool',
        role: 'tool',
        content: '',
        timestamp: 1.6,
        toolUseId: 'tu-live',
        toolName: 'Read',
        toolStatus: 'executing',
      },
    )
    managed.agent = {
      isProcessing: () => true,
      canRedirect: () => true,
      redirect,
      forceAbort,
    } as never

    await manager.sendQueuedMessageNow(managed.id, 'queue-b')

    expect(redirect).not.toHaveBeenCalled()
    expect(forceAbort).toHaveBeenCalled()
    expect(managed.stopRequested).toBe(true)
    expect(managed.wasInterrupted).toBe(true)
    expect(managed.messageQueue.map(item => item.messageId)).toEqual(['queue-b', 'queue-a'])
    expect(managed.messages.find(message => message.id === 'live-answer')).toMatchObject({
      hidden: true,
      isStreaming: false,
      turnId: 'closed-before-steer:live-answer',
    })
    expect(managed.messages.find(message => message.id === 'live-tool')?.hidden).toBe(false)
    expect(managed.messages.find(message => message.id === 'live-tool')?.timestamp)
      .toBeGreaterThan(managed.messages.find(message => message.id === 'queue-b')?.timestamp ?? 0)
    expect(managed.messages.find(message => message.id === 'queue-b')).toMatchObject({
      id: 'queue-b',
      content: 'second queued',
      isQueued: false,
    })
    expect(managed.messages.find(message => message.id === 'queue-b')?.hidden).toBe(false)
    expect(events.at(-2)).toMatchObject({
      type: 'user_message',
      status: 'accepted',
      message: { id: 'queue-b', isQueued: false },
    })
  })

  it('rejects stale reorder payloads instead of dropping queue items', async () => {
    await expect(
      manager.reorderQueuedMessages(managed.id, ['queue-a']),
    ).rejects.toThrow('Queued message order is stale')

    expect(managed.messageQueue.map(item => item.messageId)).toEqual(['queue-a', 'queue-b'])
  })

  it('restores per-message sources, model, thinking, and permission before replay', async () => {
    managed.isProcessing = false
    managed.enabledSourceSlugs = ['other-source']
    managed.model = 'model-b'
    managed.thinkingLevel = 'medium'
    managed.permissionMode = 'ask'
    const sendMessage = mock(async () => {})
    ;(manager as any).sendMessage = sendMessage

    await manager.sendQueuedMessageNow(managed.id, 'queue-a')
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(managed.enabledSourceSlugs).toEqual(['knowledge'])
    expect(managed.model).toBe('model-a')
    expect(String(managed.thinkingLevel)).toBe('high')
    expect(String(managed.permissionMode)).toBe('allow-all')
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps an item queued when its captured context cannot be restored', async () => {
    managed.isProcessing = false
    managed.enabledSourceSlugs = ['other-source']
    ;(manager as any).setSessionSources = async () => {
      throw new Error('source restore failed')
    }
    const sendMessage = mock(async () => {})
    ;(manager as any).sendMessage = sendMessage

    await (manager as any).processNextQueuedMessage(managed.id)

    expect(managed.messageQueue.map(item => item.messageId)).toEqual(['queue-a', 'queue-b'])
    expect(managed.messages.find(message => message.id === 'queue-a')?.isQueued).toBe(true)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({
      type: 'typed_error',
      error: { code: 'queued_message_replay_failed' },
    })
  })
})
