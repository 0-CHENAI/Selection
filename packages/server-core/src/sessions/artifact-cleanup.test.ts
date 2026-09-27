import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { SessionManager, createManagedSession } from './SessionManager'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { FeedbackStore } from '../reliability/feedback-store'

for (const protection of ['running', 'unknown', 'feedback', 'settled', 'collection-retry'] as const) test(`runtime version cleanup checks ${protection} references`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cleanup-service-'))
  const workspace = { id: 'cleanup', name: 'Cleanup', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const file = join(workspace.rootPath, 'result.txt'), candidate = join(workspace.rootPath, 'candidate.txt')
  writeFileSync(file, 'base'); writeFileSync(candidate, 'current')
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const manager = new SessionManager(), internal = manager as any
    const parent = createManagedSession({ id: 'parent' }, workspace as never, { messagesLoaded: true })
    internal.sessions.set(parent.id, parent)
    if (protection !== 'unknown') {
      const source = createManagedSession({ id: 'source' }, workspace as never, { messagesLoaded: true })
      source.isProcessing = protection === 'running'
      internal.sessions.set(source.id, source)
    }
    const store = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const base = store.register(file, 'source')
    const current = store.apply(base.id, base.currentVersion, candidate)
    if (protection === 'feedback') new FeedbackStore(join(workspace.rootPath, 'artifacts', 'feedback')).create('legacy', {
      sessionId: 'another-session', artifactId: base.id, baseVersion: base.currentVersion, instruction: 'revise',
    })
    if (protection === 'collection-retry') {
      const collect = spyOn(ArtifactVersions.prototype, 'cleanUnreferencedBlobs').mockImplementationOnce(() => { throw new Error('Disk cleanup unavailable') })
      try {
        await expect(manager.cleanupArtifactVersions(parent.id, base.id, current.currentVersion, [base.currentVersion], 'cleanup-request')).rejects.toThrow('Disk cleanup unavailable')
        expect(store.read(base.id).versions).toHaveLength(1)
        expect(existsSync(join(workspace.rootPath, 'artifacts', 'versions', 'blobs', base.versions[0]!.hash))).toBe(true)
      } finally { collect.mockRestore() }
    }
    const operation = manager.cleanupArtifactVersions(parent.id, base.id, current.currentVersion, [base.currentVersion], 'cleanup-request')
    if (protection === 'settled' || protection === 'collection-retry') {
      const cleaned = await operation
      expect(cleaned.versions.map(version => version.id)).toEqual([current.currentVersion])
      expect(existsSync(join(workspace.rootPath, 'artifacts', 'versions', 'blobs', base.versions[0]!.hash))).toBe(false)
      expect(await manager.cleanupArtifactVersions(parent.id, base.id, current.currentVersion, [base.currentVersion], 'cleanup-request')).toEqual(cleaned)
    } else {
      await expect(operation).rejects.toThrow('referenced')
      expect(store.read(base.id).versions).toHaveLength(2)
    }
    expect(readFileSync(file, 'utf8')).toBe('current')
    expect(store.versionBytes(base.id, current.currentVersion).toString()).toBe('current')
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
