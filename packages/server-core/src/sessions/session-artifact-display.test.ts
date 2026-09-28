import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { createManagedSession, SessionManager } from './SessionManager'

test('loading an older answer shows only files versioned by that answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-artifact-display-'))
  try {
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
    const original = join(root, 'original.docx')
    const revised = join(root, 'revised.docx')
    writeFileSync(original, 'original'); writeFileSync(revised, 'revised')
    const store = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), workspace.id)
    const oldVersion = store.register(original, 'session/user-1').versions[0]!
    const newVersion = store.register(revised, 'session/user-2').versions[0]!
    const manager = new SessionManager()
    const managed = createManagedSession({ id: 'session' }, workspace as never, { messagesLoaded: true })
    managed.messages.push(
      { id: 'user-2', role: 'user', content: 'revise', timestamp: 1 },
      { id: 'answer-2', role: 'assistant', content: '[新版](revised.docx) [原版](original.docx)', timestamp: 2,
        artifactVersions: [
          { path: 'revised.docx', versionId: newVersion.id, ordinal: 1 },
          { path: 'original.docx', versionId: oldVersion.id, ordinal: 1 },
        ] },
    )
    ;(manager as any).sessions.set(managed.id, managed)
    const shown = await manager.getSession(managed.id)
    expect(shown?.messages[1]?.artifactVersions?.map(ref => ref.path)).toEqual(['revised.docx'])
    expect(managed.messages[1]!.artifactVersions).toHaveLength(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
