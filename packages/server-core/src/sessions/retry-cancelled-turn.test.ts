import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Message } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('retryCancelledTurn', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-retry-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = { id: 'ws_test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() }
    const managed = createManagedSession({ id, name: 'retry test' }, workspace as never, { messagesLoaded: true })
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  function userMessage(): Message {
    return {
      id: 'user-1',
      role: 'user',
      content: 'original question',
      timestamp: 1,
      attachments: [{
        id: 'file-1',
        type: 'image',
        name: 'pic.png',
        mimeType: 'image/png',
        size: 4,
        storedPath: '/tmp/pic.png',
        resizedBase64: 'aaaa',
      }],
      turnContext: {
        model: 'test-model',
        thinkingLevel: 'high',
        permissionMode: 'ask',
        workMode: 'NORM',
        sourceSlugs: ['docs'],
        skillSlugs: ['commit'],
      },
    }
  }

  it('reuses the cancelled user message, its model, and its attachments', async () => {
    const managed = buildSession('retry-ok')
    managed.model = 'other-model'
    managed.thinkingLevel = 'low'
    managed.permissionMode = 'ask'
    managed.workMode = 'NORM'
    managed.progressDisabled = true
    managed.messages = [
      userMessage(),
      { id: 'assistant-1', role: 'assistant', content: 'partial', timestamp: 2 },
      { id: 'stop-1', role: 'info', content: 'Response interrupted', statusType: 'turn_cancelled', timestamp: 3 },
    ]

    const calls: unknown[][] = []
    spyOn(sm, 'sendMessage').mockImplementation(async (...args) => {
      calls.push(args)
    })

    await sm.retryCancelledTurn('retry-ok')
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(managed.model).toBe('test-model')
    expect(managed.thinkingLevel as string | undefined).toBe('high')
    expect(managed.progressDisabled).toBe(false)
    expect(managed.enabledSourceSlugs).toEqual(['docs'])
    expect(managed.lastSentOptions?.skillSlugs).toEqual(['commit'])
    expect(managed.messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['user-1'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('retry-ok')
    expect(calls[0]?.[1]).toBe('original question')
    expect(calls[0]?.[2]).toEqual([expect.objectContaining({ name: 'pic.png', storedPath: '/tmp/pic.png', base64: 'aaaa' })])
    expect(calls[0]?.[5]).toBe('user-1')
  })

  it('refuses a turn that was not cancelled', async () => {
    const managed = buildSession('retry-no')
    managed.messages = [
      userMessage(),
      { id: 'assistant-1', role: 'assistant', content: 'done', timestamp: 2 },
    ]
    await expect(sm.retryCancelledTurn('retry-no')).rejects.toThrow('No cancelled turn to retry')
    expect(managed.messages.filter(message => message.role === 'user')).toHaveLength(1)
  })
})
