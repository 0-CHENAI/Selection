import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, loadSession, updateSessionMetadata } from '../storage.ts'

describe('updateSessionMetadata model clear', () => {
  it('removes a saved model when the update sets model to undefined', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'session-model-clear-'))
    try {
      const created = await createSession(workspaceRoot, {
        workingDirectory: join(workspaceRoot, 'project'),
        model: 'retired-model',
      })
      expect(loadSession(workspaceRoot, created.id)?.model).toBe('retired-model')

      await updateSessionMetadata(workspaceRoot, created.id, { model: undefined })
      expect(loadSession(workspaceRoot, created.id)?.model).toBeUndefined()
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('does not clear the model when the update omits the field', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'session-model-keep-'))
    try {
      const created = await createSession(workspaceRoot, {
        workingDirectory: join(workspaceRoot, 'project'),
        model: 'kept-model',
      })

      await updateSessionMetadata(workspaceRoot, created.id, { name: 'Renamed' })
      const session = loadSession(workspaceRoot, created.id)
      expect(session?.name).toBe('Renamed')
      expect(session?.model).toBe('kept-model')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
