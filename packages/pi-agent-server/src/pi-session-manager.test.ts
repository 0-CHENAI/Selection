import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import {
  createPiSessionManager,
  rehydratePiToolImages,
  sanitizePiMessageForPersistence,
  TOOL_IMAGE_SIDECAR_DIR,
} from './pi-session-manager.ts'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-regenerate-'))
  roots.push(root)
  return root
}

function user(content: string, timestamp: number): Message {
  return { role: 'user', content, timestamp }
}

function assistant(content: string, timestamp: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  }
}

function textFromContext(manager: PiSessionManager): string[] {
  return manager.buildSessionContext().messages.map(message => {
    if (typeof message.content === 'string') return message.content
    return message.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('')
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Pi regenerate session isolation (#13)', () => {
  it('creates a fresh native session for the first response instead of continuing the old answer', () => {
    const root = tempRoot()
    const craftSessionPath = join(root, 'session-a')
    const sessionDir = join(craftSessionPath, '.pi-sessions')
    mkdirSync(sessionDir, { recursive: true })

    const old = PiSessionManager.create(root, sessionDir)
    old.appendMessage(user('ORIGINAL_PROMPT', 1))
    old.appendMessage(assistant('OLD_ASSISTANT_RESPONSE', 2))

    const regenerated = createPiSessionManager({
      cwd: root,
      sessionDir,
      forceFreshSession: true,
    })
    regenerated.appendMessage(user('ORIGINAL_PROMPT', 3))

    expect(regenerated.getSessionId()).not.toBe(old.getSessionId())
    expect(textFromContext(regenerated)).toEqual(['ORIGINAL_PROMPT'])
  })

  it('forks a multi-turn session at the previous assistant anchor and sends the target user once', () => {
    const root = tempRoot()
    const craftSessionPath = join(root, 'session-b')
    const sessionDir = join(craftSessionPath, '.pi-sessions')
    mkdirSync(sessionDir, { recursive: true })

    const old = PiSessionManager.create(root, sessionDir)
    old.appendMessage(user('FIRST_USER', 1))
    const previousAssistantAnchor = old.appendMessage(assistant('FIRST_ASSISTANT', 2))
    old.appendMessage(user('TARGET_USER', 3))
    old.appendMessage(assistant('OLD_ASSISTANT_RESPONSE', 4))

    const regenerated = createPiSessionManager({
      cwd: root,
      sessionDir,
      branchFromSessionPath: craftSessionPath,
      branchFromSdkSessionId: old.getSessionId(),
      branchFromSdkTurnId: previousAssistantAnchor,
    })
    regenerated.appendMessage(user('TARGET_USER', 5))

    expect(regenerated.getSessionId()).not.toBe(old.getSessionId())
    expect(textFromContext(regenerated)).toEqual([
      'FIRST_USER',
      'FIRST_ASSISTANT',
      'TARGET_USER',
    ])
  })

  it('resumes the requested native session id instead of a newer failed regenerate file', () => {
    const root = tempRoot()
    const sessionDir = join(root, 'session-c', '.pi-sessions')
    mkdirSync(sessionDir, { recursive: true })

    const original = PiSessionManager.create(root, sessionDir)
    original.appendMessage(user('ORIGINAL_PROMPT', 1))
    original.appendMessage(assistant('ORIGINAL_ASSISTANT', 2))

    const failedRegenerate = PiSessionManager.create(root, sessionDir)
    failedRegenerate.appendMessage(user('FAILED_REGENERATE_PROMPT', 3))

    const resumed = createPiSessionManager({
      cwd: root,
      sessionDir,
      resumeSdkSessionId: original.getSessionId(),
    })

    expect(resumed.getSessionId()).toBe(original.getSessionId())
    expect(textFromContext(resumed)).toEqual(['ORIGINAL_PROMPT', 'ORIGINAL_ASSISTANT'])
  })
})

describe('Pi tool image persistence', () => {
  it('keeps the live image block but omits Base64 from session JSONL', () => {
    const root = tempRoot()
    const sessionDir = join(root, 'session-images', '.pi-sessions')
    mkdirSync(sessionDir, { recursive: true })

    const imageData = 'aW1hZ2UtYnl0ZXMtdGhhdC1tdXN0LW5vdC1iZS1wZXJzaXN0ZWQ='
    const toolResult: Message = {
      role: 'toolResult',
      toolCallId: 'office-render-1',
      toolName: 'office_document_preview',
      content: [
        { type: 'text', text: 'Artifact: /tmp/session/data/office/page-1.png' },
        { type: 'image', data: imageData, mimeType: 'image/png' },
      ],
      isError: false,
      timestamp: 1,
    }

    const sanitized = sanitizePiMessageForPersistence(toolResult)
    expect(sanitized).not.toBe(toolResult)
    expect(JSON.stringify(sanitized)).not.toContain(imageData)
    expect(JSON.stringify(toolResult)).toContain(imageData)

    const manager = createPiSessionManager({ cwd: root, sessionDir, forceFreshSession: true })
    manager.appendMessage(assistant('Calling preview', 0))
    manager.appendMessage(toolResult)

    const sessionFile = manager.getSessionFile()
    expect(sessionFile).toBeTruthy()
    const persisted = readFileSync(sessionFile!, 'utf8')
    expect(persisted).toContain('/tmp/session/data/office/page-1.png')
    expect(persisted).toContain('Inline tool image omitted from session JSONL')
    expect(persisted).not.toContain(imageData)
    expect(JSON.stringify(toolResult)).toContain(imageData)
  })

  it('writes a sidecar and rehydrates tool images into later model context', () => {
    const root = tempRoot()
    const sessionDir = join(root, 'session-rehydrate', '.pi-sessions')
    mkdirSync(sessionDir, { recursive: true })

    const imageData = Buffer.from('tool-image-pixels').toString('base64')
    const toolResult: Message = {
      role: 'toolResult',
      toolCallId: 'read-image-1',
      toolName: 'Read',
      content: [
        { type: 'text', text: 'Read image file [image/png]' },
        { type: 'image', data: imageData, mimeType: 'image/png' },
      ],
      isError: false,
      timestamp: 1,
    }

    const manager = createPiSessionManager({ cwd: root, sessionDir, forceFreshSession: true })
    manager.appendMessage(assistant('Reading image', 0))
    manager.appendMessage(toolResult)

    const persisted = readFileSync(manager.getSessionFile()!, 'utf8')
    expect(persisted).toContain('Inline tool image omitted from session JSONL')
    expect(persisted).toContain('sha256=')
    expect(persisted).not.toContain(imageData)

    const context = manager.buildSessionContext()
    const restored = context.messages.find(message => message.role === 'toolResult')
    expect(restored && 'content' in restored ? restored.content : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', data: imageData, mimeType: 'image/png' }),
    ]))

    const resumed = createPiSessionManager({
      cwd: root,
      sessionDir,
      resumeSdkSessionId: manager.getSessionId(),
    })
    const resumedContext = resumed.buildSessionContext()
    const resumedTool = resumedContext.messages.find(message => message.role === 'toolResult')
    expect(resumedTool && 'content' in resumedTool ? resumedTool.content : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', data: imageData, mimeType: 'image/png' }),
    ]))
    expect(readdirSync(join(sessionDir, TOOL_IMAGE_SIDECAR_DIR)).length).toBeGreaterThan(0)
  })

  it('rehydrates a legacy placeholder from a sibling artifact path', () => {
    const root = tempRoot()
    const artifact = join(root, 'page-1.png')
    const bytes = Buffer.from('artifact-pixels')
    writeFileSync(artifact, bytes)

    const placeholder = sanitizePiMessageForPersistence({
      role: 'toolResult',
      toolCallId: 'office-1',
      toolName: 'office_document_preview',
      content: [
        { type: 'text', text: `Artifact: ${artifact}` },
        { type: 'image', data: 'should-not-remain', mimeType: 'image/png' },
      ],
      isError: false,
      timestamp: 1,
    })

    const restored = rehydratePiToolImages(placeholder, root)
    expect(restored.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'image',
        data: bytes.toString('base64'),
        mimeType: 'image/png',
      }),
    ]))
    expect(JSON.stringify(placeholder)).not.toContain('should-not-remain')
  })

  it('does not treat a non-image Artifact path as pixels', () => {
    const root = tempRoot()
    const secret = join(root, 'notes.txt')
    writeFileSync(secret, 'not-an-image')

    const restored = rehydratePiToolImages({
      role: 'toolResult',
      toolCallId: 'office-2',
      toolName: 'office_document_preview',
      content: [
        { type: 'text', text: `Artifact: ${secret}` },
        { type: 'text', text: '[Inline tool image omitted from session JSONL; use the artifact path and metadata in the text result.]' },
      ],
      isError: false,
      timestamp: 1,
    }, root)

    expect(restored.content.some(part => part.type === 'image')).toBe(false)
  })

  it('pairs multiple legacy placeholders to distinct artifact images', () => {
    const root = tempRoot()
    const first = Buffer.from('first-artifact')
    const second = Buffer.from('second-artifact')
    writeFileSync(join(root, 'one.png'), first)
    writeFileSync(join(root, 'two.png'), second)

    const restored = rehydratePiToolImages({
      role: 'toolResult',
      toolCallId: 'office-3',
      toolName: 'office_document_preview',
      content: [
        { type: 'text', text: `Artifact: ${join(root, 'one.png')}\nArtifact: ${join(root, 'two.png')}` },
        { type: 'text', text: '[Inline tool image omitted from session JSONL; use the artifact path and metadata in the text result.]' },
        { type: 'text', text: '[Inline tool image omitted from session JSONL; use the artifact path and metadata in the text result.]' },
      ],
      isError: false,
      timestamp: 1,
    }, root)

    const images = restored.content.filter(part => part.type === 'image')
    expect(images).toEqual([
      expect.objectContaining({ data: first.toString('base64') }),
      expect.objectContaining({ data: second.toString('base64') }),
    ])
  })

  it('copies tool-image sidecars when forking into a new session directory', () => {
    const root = tempRoot()
    const parentCraft = join(root, 'session-parent')
    const parentSessionDir = join(parentCraft, '.pi-sessions')
    const childSessionDir = join(root, 'session-child', '.pi-sessions')
    mkdirSync(parentSessionDir, { recursive: true })
    mkdirSync(childSessionDir, { recursive: true })

    const imageData = Buffer.from('forked-tool-pixels').toString('base64')
    const parent = createPiSessionManager({ cwd: root, sessionDir: parentSessionDir, forceFreshSession: true })
    parent.appendMessage(assistant('Reading image', 0))
    parent.appendMessage({
      role: 'toolResult',
      toolCallId: 'read-image-fork',
      toolName: 'Read',
      content: [
        { type: 'text', text: 'Read image file [image/png]' },
        { type: 'image', data: imageData, mimeType: 'image/png' },
      ],
      isError: false,
      timestamp: 1,
    })

    const child = createPiSessionManager({
      cwd: root,
      sessionDir: childSessionDir,
      branchFromSessionPath: parentCraft,
      branchFromSdkSessionId: parent.getSessionId(),
    })
    const restored = child.buildSessionContext().messages.find(message => message.role === 'toolResult')
    expect(restored && 'content' in restored ? restored.content : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image', data: imageData, mimeType: 'image/png' }),
    ]))
    expect(readdirSync(join(childSessionDir, TOOL_IMAGE_SIDECAR_DIR)).length).toBeGreaterThan(0)
  })
})
