import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { loadSession as loadStoredSession, saveSession as saveStoredSession } from '@craft-agent/shared/sessions'
import { parseArtifactRestoreResult } from '@craft-agent/shared/utils/artifact-restore-message'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { createManagedSession, SessionManager } from './SessionManager'

test('dialog restore moves the current pointer from version 2 to version 1 and records its summary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-dialog-restore-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const file = join(workspace.rootPath, 'hello.docx')
    const candidate = join(workspace.rootPath, 'revised.docx')
    writeFileSync(file, 'hello')
    writeFileSync(candidate, 'hi')
    const store = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const first = store.register(file, 'session/user-1', [], '用户请求创建 Word 文档')
    const second = store.apply(first.id, first.currentVersion, candidate, 'session/user-2')
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    managed.messages.push(
      { id: 'user-1', role: 'user', content: '创建文档', timestamp: 1 },
      { id: 'answer-1', role: 'assistant', content: '生成仅含 hello 的 Word 文档', timestamp: 2,
        artifactVersions: [{ path: file, artifactId: first.id, versionId: first.currentVersion, ordinal: 1 }] },
      { id: 'user-2', role: 'user', content: '修改文档', timestamp: 3 },
      { id: 'answer-2', role: 'assistant', content: '正文由 hello 改为 hi', timestamp: 4,
        artifactVersions: [{ path: file, artifactId: first.id, versionId: second.currentVersion, ordinal: 2 }] },
    )
    ;(manager as any).sessions.set(managed.id, managed)
    const events: Array<{ type: string }> = []
    manager.setEventSink((_channel, _target, event) => events.push(event))

    const restored = await manager.restoreArtifactVersionForSession(managed.id, first.id, second.currentVersion, first.currentVersion)
    expect(first.currentVersion).not.toBe(second.currentVersion)
    expect(restored.currentVersion).toBe(first.currentVersion)
    expect(restored.versions).toHaveLength(2)
    expect(readFileSync(file, 'utf8')).toBe('hello')
    const saved = loadStoredSession(workspace.rootPath, managed.id)!
    expect(saved.messages.at(-2)?.content).toContain('从第 2 版恢复到第 1 版')
    expect(saved.messages.at(-2)?.content).toContain('生成仅含 hello 的 Word 文档')
    expect(parseArtifactRestoreResult(saved.messages.at(-2)!.content)?.versionId).toBe(first.currentVersion)
    expect(saved.messages.at(-1)?.content).toContain('已将 hello.docx 恢复到第 1 版')
    expect(saved.messages.at(-1)?.artifactVersions).toEqual([{
      path: restored.path, artifactId: first.id, versionId: first.currentVersion,
      ordinal: 1, sessionOrdinal: 1, change: 'restored',
    }])
    expect(events.find(event => event.type === 'text_complete')).toMatchObject({
      artifactVersions: [{ path: restored.path, versionId: first.currentVersion, change: 'restored' }],
    })
    expect(events.map(event => event.type).slice(-3)).toEqual(['user_message', 'text_complete', 'complete'])

    // Older direct-restore confirmations were persisted without a file ref.
    saved.messages.at(-1)!.artifactVersions = undefined
    await saveStoredSession(saved)
    const reloadedManager = new SessionManager()
    const cold = createManagedSession({ id: managed.id }, workspace as never, { messagesLoaded: false })
    ;(reloadedManager as any).sessions.set(cold.id, cold)
    const historical = await reloadedManager.getSession(managed.id)
    expect(historical?.messages.at(-1)?.artifactVersions).toMatchObject([{
      path: restored.path, artifactId: first.id, versionId: first.currentVersion, change: 'restored',
    }])

    await expect(manager.restoreArtifactVersionForSession(managed.id, first.id, second.currentVersion, first.currentVersion)).rejects.toThrow()
    expect(loadStoredSession(workspace.rootPath, managed.id)?.messages).toHaveLength(saved.messages.length)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('dialog restore leaves externally edited bytes and chat untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-dialog-conflict-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const file = join(workspace.rootPath, 'hello.docx')
    const candidate = join(workspace.rootPath, 'revised.docx')
    writeFileSync(file, 'hello'); writeFileSync(candidate, 'hi')
    const store = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, candidate)
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    managed.messages.push({ id: 'answer-1', role: 'assistant', content: 'created', timestamp: 1,
      artifactVersions: [{ path: file, artifactId: first.id, versionId: first.currentVersion, ordinal: 1, change: 'created' }] })
    ;(manager as any).sessions.set(managed.id, managed)
    writeFileSync(file, 'external edit')
    await expect(manager.restoreArtifactVersionForSession(managed.id, first.id, second.currentVersion, first.currentVersion)).rejects.toThrow('Artifact changed')
    expect(readFileSync(file, 'utf8')).toBe('external edit')
    expect(store.read(first.id).currentVersion).toBe(second.currentVersion)
    expect(managed.messages).toHaveLength(1)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('an older chat can restore its own version even when the current version came from another chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-cross-chat-restore-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const file = join(workspace.rootPath, 'hello.docx')
    const candidate = join(workspace.rootPath, 'revised.docx')
    writeFileSync(file, 'hello'); writeFileSync(candidate, 'hi')
    const store = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, candidate, 'new/user-1')
    const manager = new SessionManager()
    manager.setEventSink(() => {})
    const oldChat = createManagedSession({ id: 'old' }, workspace as never, { messagesLoaded: true })
    oldChat.messages.push({ id: 'answer-1', role: 'assistant', content: '生成仅含 hello 的 Word 文档', timestamp: 1,
      artifactVersions: [{ path: file, artifactId: first.id, versionId: first.currentVersion, ordinal: 1, change: 'created' }] })
    ;(manager as any).sessions.set(oldChat.id, oldChat)

    const restored = await manager.restoreArtifactVersionForSession(oldChat.id, first.id, second.currentVersion, first.currentVersion)
    expect(restored.currentVersion).toBe(first.currentVersion)
    expect(readFileSync(file, 'utf8')).toBe('hello')
    const card = loadStoredSession(workspace.rootPath, oldChat.id)?.messages.at(-2)?.content ?? ''
    expect(card).toContain('恢复到第 1 版')
    expect(card).not.toContain('从第 2 版')
    expect(card).toContain('生成仅含 hello 的 Word 文档')
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('a historical link that was never delivered cannot authorize a restore', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-undelivered-restore-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  try {
    const file = join(workspace.rootPath, 'hello.docx')
    const candidate = join(workspace.rootPath, 'revised.docx')
    writeFileSync(file, 'hello'); writeFileSync(candidate, 'hi')
    const store = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, candidate)
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    managed.messages.push({ id: 'user-1', role: 'user', content: '查看文件', timestamp: 1 },
      { id: 'answer-1', role: 'assistant', content: '这里有文件链接', timestamp: 2,
        artifactVersions: [{ path: file, artifactId: first.id, versionId: first.currentVersion, ordinal: 1 }] })
    ;(manager as any).sessions.set(managed.id, managed)

    await expect(manager.restoreArtifactVersionForSession(managed.id, first.id, second.currentVersion, first.currentVersion)).rejects.toThrow('not referenced by this chat')
    expect(readFileSync(file, 'utf8')).toBe('hi')
    expect(store.read(first.id).currentVersion).toBe(second.currentVersion)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
