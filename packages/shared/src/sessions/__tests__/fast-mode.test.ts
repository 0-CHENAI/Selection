import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, loadSession, saveSession } from '../storage'

test('Fast defaults off and persists independently for each session and reasoning level', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fast-session-'))
  try {
    const standard = await createSession(root)
    const fast = await createSession(root, { fastMode: true, thinkingLevel: 'high' })
    expect(loadSession(root, standard.id)?.fastMode ?? false).toBe(false)
    expect(loadSession(root, fast.id)?.fastMode).toBe(true)
    const loaded = loadSession(root, fast.id)!
    loaded.fastMode = false
    await saveSession(loaded)
    expect(loadSession(root, fast.id)?.fastMode).toBe(false)
    expect(loadSession(root, fast.id)?.thinkingLevel).toBe('high')
    expect(loadSession(root, standard.id)?.fastMode ?? false).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
