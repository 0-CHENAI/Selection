import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, renameSync, realpathSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { createSession, loadSession, saveSession } from '@craft-agent/shared/sessions'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { ArtifactVersions } from '../../reliability/artifact-versions'
import { registerFilesHandlers } from './files'
import type { HandlerFn, RpcServer, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

test('session restore RPC checks the chat workspace before dispatching the selected versions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-session-restore-rpc-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const calls: unknown[][] = []
    const handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {
      sessionManager: {
        getSession: async () => ({ workspaceId: workspace.id }),
        restoreArtifactVersionForSession: async (...args: unknown[]) => { calls.push(args); return { id: 'artifact' } },
      },
    } as unknown as HandlerDeps)
    const manage = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    const operation = { type: 'restoreForSession', sessionId: 'session', artifactId: 'artifact',
      expectedVersion: 'v2', versionId: 'v1' }
    await expect(manage({ clientId: 'client', workspaceId: 'other' } as RequestContext, operation)).rejects.toThrow('does not belong')
    expect(calls).toHaveLength(0)
    expect(await manage({ clientId: 'client', workspaceId: workspace.id } as RequestContext, operation)).toEqual({ id: 'artifact' })
    expect(calls).toEqual([['session', 'artifact', 'v2', 'v1']])
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('restore and relocation notify only after successful artifact publication', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-notify-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt')
    writeFileSync(file, 'old'); writeFileSync(candidate, 'new')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const old = store.register(file), current = store.apply(old.id, old.currentVersion, candidate)
    const notifications: string[] = [], handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {
      sessionManager: { notifyArtifactApplied: (id: string) => notifications.push(id) },
    } as unknown as HandlerDeps)
    const manage = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    const context = { clientId: 'client', workspaceId: workspace.id } as RequestContext
    await expect(manage(context, { type: 'restore', artifactId: old.id, expectedVersion: old.currentVersion, versionId: old.currentVersion })).rejects.toThrow()
    expect(notifications).toEqual([])
    const restored = await manage(context, { type: 'restore', artifactId: old.id, expectedVersion: current.currentVersion, versionId: old.currentVersion }) as typeof old
    expect(notifications).toEqual([workspace.id])
    await manage(context, { type: 'relocate', artifactId: old.id, expectedVersion: restored.currentVersion, path: candidate })
    expect(notifications).toEqual([workspace.id, workspace.id])
    expect(store.read(old.id).currentVersion).not.toBe(restored.currentVersion)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('a relocated artifact opens through its exact saved alias, with content and current access rechecked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-open-relocated-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const originalPath = join(root, 'original.txt'), moved = join(root, 'moved.txt')
    writeFileSync(originalPath, 'original content')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const original = store.register(originalPath)
    renameSync(originalPath, moved)
    const handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {} as HandlerDeps)
    const context = { clientId: 'client', workspaceId: workspace.id } as RequestContext
    const statPath = handlers.get(RPC_CHANNELS.fs.STAT_PATH)!
    expect(await statPath(context, originalPath)).toEqual({ path: realpathSync(moved), type: 'file' })
    expect(store.read(original.id).path).toBe(realpathSync(moved))
    const register = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    expect((await register(context, { type: 'register', path: join(root, 'absent.txt'), alternativePaths: [originalPath] }) as typeof original).id).toBe(original.id)
    expect(await statPath(context, originalPath)).toEqual({ path: realpathSync(moved), type: 'file' })
    writeFileSync(moved, 'external modification')
    await expect(statPath(context, originalPath)).rejects.toThrow('Artifact content changed')
    expect(store.read(original.id).currentVersion).toBe(original.currentVersion)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('opening an older artifact shows the AI answer title without changing its saved version record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-old-title-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const file = join(root, 'report.docx')
    writeFileSync(file, 'document bytes')
    const session = await createSession(root)
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const record = store.register(file, `${session.id}/user-1`, [], '请帮我调整报告')
    const saved = loadSession(root, session.id)!
    saved.messages = [{ id: 'answer-1', type: 'assistant', content: '已修复目录分页并统一表格格式。\n\n[报告](report.docx)',
      artifactVersions: [{ path: file, versionId: record.currentVersion, ordinal: 1 }] }]
    await saveSession(saved)
    const handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {} as HandlerDeps)
    const manage = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    const context = { clientId: 'client', workspaceId: workspace.id } as RequestContext
    const shown = await manage(context, { type: 'register', path: file }) as typeof record
    expect(shown.versions[0]).toMatchObject({ summary: '已修复目录分页并统一表格格式。', summaryOrigin: 'assistant' })
    expect(store.read(record.id).versions[0]?.summary).toBe('请帮我调整报告')
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('version actions follow a renamed file by saved identity and show only the owning chat history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-session-view-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const originalPath = join(root, 'original.txt'), moved = join(root, 'renamed.txt')
    writeFileSync(originalPath, 'first')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const first = store.register(originalPath, 'old/user-1', [], 'First', 'assistant')
    renameSync(originalPath, moved)
    expect(store.register(moved).id).toBe(first.id)
    writeFileSync(moved, 'second')
    const second = store.capture(first.id, 'new/user-1', 'Second', 'assistant')
    const messages = (id: string, versionId: string) => [{ id: `answer-${id}`, role: 'assistant', content: 'delivered', timestamp: 1,
      artifactVersions: [{ path: originalPath, artifactId: first.id, versionId, ordinal: id === 'old' ? 1 : 2, change: 'created' }] }]
    const handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {
      sessionManager: { getSession: async (id: string) => ({ id, workspaceId: workspace.id,
        messages: messages(id, id === 'old' ? first.currentVersion : second.currentVersion) }) },
    } as unknown as HandlerDeps)
    const manage = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    const context = { clientId: 'client', workspaceId: workspace.id } as RequestContext
    const shown = await manage(context, { type: 'register', path: originalPath, sessionId: 'new', versionId: second.currentVersion }) as typeof second
    expect(shown.path).toBe(realpathSync(moved))
    expect(shown.versions.map(version => [version.id, version.ordinal])).toEqual([[second.currentVersion, 1]])
    const old = await manage(context, { type: 'register', path: originalPath, sessionId: 'old', versionId: first.currentVersion }) as typeof first
    expect(old.versions.map(version => [version.id, version.ordinal])).toEqual([[first.currentVersion, 1]])
    expect(store.read(first.id).versions).toHaveLength(2)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('an old version does not claim a new file that reused its path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-reused-rpc-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const file = join(root, 'report.txt')
    writeFileSync(file, 'original')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const old = store.register(file)
    rmSync(file)
    writeFileSync(file, 'replacement')
    const handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {
      sessionManager: { getSession: async () => ({ workspaceId: workspace.id, messages: [{ role: 'assistant',
        artifactVersions: [{ versionId: old.currentVersion, artifactId: old.id }] }] }) },
    } as unknown as HandlerDeps)
    const manage = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    const context = { clientId: 'client', workspaceId: workspace.id } as RequestContext
    const historical = await manage(context, { type: 'register', path: file, sessionId: 'chat', versionId: old.currentVersion }) as typeof old & { currentFileAvailable: boolean }
    expect(historical.id).toBe(old.id)
    expect(historical.currentFileAvailable).toBe(false)
    const replacement = await manage(context, { type: 'register', path: file }) as typeof historical
    expect(replacement.id).not.toBe(old.id)
    expect(replacement.currentFileAvailable).toBe(true)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('reading an artifact follows a rename even when its old path was reused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-read-rename-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const oldPath = join(root, 'old.txt'), moved = join(root, 'moved.txt')
    writeFileSync(oldPath, 'original')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const original = store.register(oldPath)
    renameSync(oldPath, moved)
    writeFileSync(oldPath, 'replacement')
    const handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {} as HandlerDeps)
    const manage = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    const context = { clientId: 'client', workspaceId: workspace.id } as RequestContext
    const shown = await manage(context, { type: 'read', artifactId: original.id }) as typeof original & { currentFileAvailable: boolean }
    expect(shown.path).toBe(realpathSync(moved))
    expect(shown.currentFileAvailable).toBe(true)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('an older record without file identity can be explicitly rebound after a rename', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-legacy-rename-'))
  const workspace = { id: 'workspace', rootPath: root, name: 'Workspace' }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const original = join(root, 'original.txt'), moved = join(root, 'renamed.txt')
    writeFileSync(original, 'original')
    const storage = join(root, 'artifacts', 'versions')
    const store = new ArtifactVersions(storage, hostname(), workspace.id)
    const first = store.register(original)
    const legacy = { ...first, fileIdentity: undefined }
    writeFileSync(join(storage, `${first.id}.json`), JSON.stringify(legacy))
    renameSync(original, moved)
    const handlers = new Map<string, HandlerFn>()
    registerFilesHandlers({ handle(channel, handler) { handlers.set(channel, handler) } } as RpcServer, {
      sessionManager: { getSession: async () => ({ workspaceId: workspace.id, messages: [{ role: 'assistant',
        artifactVersions: [{ versionId: first.currentVersion }] }] }) },
    } as unknown as HandlerDeps)
    const manage = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    const context = { clientId: 'client', workspaceId: workspace.id } as RequestContext
    const before = await manage(context, { type: 'register', path: original, sessionId: 'chat', versionId: first.currentVersion }) as typeof first
    expect(before.path).toBe(first.path)
    await manage(context, { type: 'relocate', artifactId: first.id, path: moved, expectedVersion: first.currentVersion })
    const after = await manage(context, { type: 'register', path: original, sessionId: 'chat', versionId: first.currentVersion }) as typeof first
    expect(after.path).toBe(realpathSync(moved))
    expect(after.versions.map(version => version.ordinal)).toEqual([1])
    expect(store.read(first.id).id).toBe(first.id)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
