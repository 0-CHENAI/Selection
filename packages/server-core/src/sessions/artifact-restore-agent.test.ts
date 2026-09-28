import { expect, test, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { createManagedSession, SessionManager } from './SessionManager'

test('agent restore creates a new full-file version and rejects stale or externally edited state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-agent-restore-'))
  const workspace = { id: 'restore-workspace', name: 'Restore', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const file = join(workspace.rootPath, 'report.docx')
  const changed = join(workspace.rootPath, 'changed.docx')
  writeFileSync(file, Buffer.from([0, 1, 2, 3]))
  writeFileSync(changed, Buffer.from([4, 5, 6, 7]))
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const manager = new SessionManager()
    const session = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    ;(manager as any).sessions.set(session.id, session)
    const store = new ArtifactVersions(join(workspace.rootPath, 'artifacts', 'versions'), hostname(), workspace.id)
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, changed)
    const manage = (request: unknown) => (manager as any).manageArtifactVersionFromAgent(session, request)
    await expect(manage({ action: 'restore', artifactId: first.id,
      versionId: second.currentVersion, expectedVersion: second.currentVersion })).rejects.toThrow('previous version')
    session.messages.push({ id: 'request', role: 'user', content: `Restore this version.\n<artifact_restore_request>\n${JSON.stringify({
      action: 'restore', path: file, artifactId: first.id,
      versionId: first.currentVersion, expectedVersion: second.currentVersion,
    })}\n</artifact_restore_request>`, timestamp: 1 })
    expect((await manage({ action: 'list', path: file })).currentVersion).toBe(second.currentVersion)
    await expect(manage({ action: 'restore', artifactId: first.id,
      versionId: second.currentVersion, expectedVersion: second.currentVersion })).rejects.toThrow('Restore request changed')
    await expect(manage({ action: 'restore', path: file, artifactId: first.id,
      versionId: first.currentVersion, expectedVersion: first.currentVersion })).rejects.toThrow('Restore request changed')
    const restored = await manage({ action: 'restore', path: file, artifactId: first.id,
      versionId: first.currentVersion, expectedVersion: second.currentVersion })
    expect(restored.versions).toHaveLength(3)
    expect(restored.versions.at(-1)?.restoredFrom).toBe(first.currentVersion)
    expect(restored.versions.at(-1)?.sourceRunId).toBe(`${session.id}/request`)
    expect(readFileSync(file)).toEqual(Buffer.from([0, 1, 2, 3]))
    session.messages.push({ id: 'later-request', role: 'user', content: 'Restore again', timestamp: 2 })
    await expect(manage({ action: 'restore', artifactId: first.id,
      versionId: second.currentVersion, expectedVersion: second.currentVersion })).rejects.toThrow('Artifact changed')
    writeFileSync(file, Buffer.from([9, 9]))
    await expect(manage({ action: 'restore', path: file, artifactId: first.id,
      versionId: first.currentVersion, expectedVersion: restored.currentVersion })).rejects.toThrow('Artifact changed')
    expect(readFileSync(file)).toEqual(Buffer.from([9, 9]))
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})
