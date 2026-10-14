import { describe, expect, it } from 'bun:test'
import { createManagedSession, SessionManager } from './SessionManager.ts'

describe('browser password redaction on tool_result', () => {
  function setup(command: unknown, toolName = 'browser_tool') {
    const manager = new SessionManager()
    const managed = createManagedSession(
      { id: 'session-password' },
      { id: 'workspace-1', name: 'Workspace', rootPath: '/tmp/browser-password' } as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    managed.messages = [{
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: 1,
      toolName,
      toolUseId: 'tool-1',
      toolInput: { command },
      toolStatus: 'executing',
    }]
    ;(manager as any).sessions.set(managed.id, managed)
    ;(manager as any).persistSession = () => { persists += 1 }
    const events: any[] = []
    let persists = 0
    manager.setEventSink((_channel, _target, event) => events.push(event))
    return {
      manager,
      managed,
      events,
      persists: () => persists,
    }
  }

  async function finish(setupResult: ReturnType<typeof setup>, result: string, isError = false) {
    await (setupResult.manager as any).processEvent(setupResult.managed, {
      type: 'tool_result',
      toolUseId: 'tool-1',
      toolName: setupResult.managed.messages[0]?.toolName,
      result,
      isError,
    })
  }

  it('stores a placeholder and tells the renderer to replace the input', async () => {
    const session = setup('fill @e2 hunter2')
    await finish(session, 'Filled password field @e2 (7 characters)')

    expect(session.managed.messages[0]?.toolInput).toEqual({ command: 'fill @e2 [password: 7 characters]' })
    expect(JSON.stringify(session.managed.messages)).not.toContain('hunter2')
    expect(session.persists()).toBe(1)
    expect(session.events.filter(event => event.type === 'tool_result')).toEqual([
      expect.objectContaining({
        toolInput: { command: 'fill @e2 [password: 7 characters]' },
      }),
    ])
  })

  it('redacts array-mode commands', async () => {
    const session = setup(['fill', '@e2', 'hunter2 secret'])
    await finish(session, 'Filled password field @e2 (14 characters)')
    expect(session.managed.messages[0]?.toolInput).toEqual({
      command: ['fill', '@e2', '[password: 14 characters]'],
    })
  })

  it('stores a placeholder when page metrics could not confirm the field', async () => {
    const session = setup('fill @e1 user@example.com; fill @e2 hunter2')
    await finish(session, 'Filled field without page metrics @e1 (16 characters)\nFilled field without page metrics @e2 (7 characters)')

    expect(session.managed.messages[0]?.toolInput).toEqual({
      command: 'fill @e1 [redacted: 16 characters]; fill @e2 [redacted: 7 characters]',
    })
    expect(JSON.stringify(session.managed.messages)).not.toContain('hunter2')
    expect(JSON.stringify(session.managed.messages)).not.toContain('user@example.com')
    expect(session.events.filter(event => event.type === 'tool_result')).toEqual([
      expect.objectContaining({
        toolInput: {
          command: 'fill @e1 [redacted: 16 characters]; fill @e2 [redacted: 7 characters]',
        },
      }),
    ])
  })

  it('leaves an ordinary fill and a non-browser tool alone', async () => {
    const ordinary = setup('fill @e2 hunter2')
    await finish(ordinary, 'Filled element @e2 with "hunter2"')
    expect(ordinary.managed.messages[0]?.toolInput).toEqual({ command: 'fill @e2 hunter2' })
    expect(ordinary.events[0]?.toolInput).toBeUndefined()

    const bash = setup('echo Filled password field @e2', 'Bash')
    await finish(bash, 'Filled password field @e2 (7 characters)')
    expect(bash.managed.messages[0]?.toolInput).toEqual({ command: 'echo Filled password field @e2' })
    expect(bash.events[0]?.toolInput).toBeUndefined()
  })

  it('does not send a second event when the same result arrives again', async () => {
    const session = setup('fill @e2 hunter2')
    const result = 'Filled password field @e2 (7 characters)'
    await finish(session, result)
    await finish(session, result)

    expect(session.managed.messages[0]?.toolInput).toEqual({ command: 'fill @e2 [password: 7 characters]' })
    expect(session.events.filter(event => event.type === 'tool_result')).toHaveLength(1)
    expect(session.persists()).toBe(2)
  })
})
