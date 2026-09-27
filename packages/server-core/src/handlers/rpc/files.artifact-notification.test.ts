import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, renameSync, realpathSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { ArtifactVersions } from '../../reliability/artifact-versions'
import { registerFilesHandlers } from './files'
import type { HandlerFn, RpcServer, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

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
    expect(await statPath(context, originalPath)).toBeNull()
    const register = handlers.get(RPC_CHANNELS.artifacts.MANAGE)!
    expect((await register(context, { type: 'register', path: join(root, 'absent.txt'), alternativePaths: [originalPath] }) as typeof original).id).toBe(original.id)
    store.relocate(original.id, moved, original.currentVersion)
    expect(await statPath(context, originalPath)).toEqual({ path: realpathSync(moved), type: 'file' })
    writeFileSync(moved, 'external modification')
    await expect(statPath(context, originalPath)).rejects.toThrow('Artifact content changed')
    expect(store.read(original.id).currentVersion).toBe(original.currentVersion)
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
