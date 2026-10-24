import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PptRequest } from '../../protocol/ppt.ts'
import { createSession, getSessionFilePath, listSessions, loadSession, saveSession } from '../storage.ts'
import { readSessionHeader, readSessionHeaderAsync } from '../jsonl.ts'

test('PPT settings including large brand logo survive create, full save/load, list and both header readers', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ppt-session-')))
  try {
    const ppt: PptRequest = { templateId: 'dsh-cartesian', themeId: 'academic', brandColor: '#123456', aspectRatio: '4:3', logo: { name: '品牌.png', mimeType: 'image/png', base64: Buffer.alloc(24 * 1024, 97).toString('base64') } }
    const created = await createSession(root, { ppt })
    expect(created.workMode).toBe('PRO')
    expect(loadSession(root, created.id)?.ppt).toEqual(ppt)
    const stored = loadSession(root, created.id)!
    const turnPpt: PptRequest = { templateId: 'dsh-course-workshop', aspectRatio: '16:9' }
    stored.messages.push({ id: 'queued-ppt', type: 'user', content: '自然语言要求不变', timestamp: Date.now(), turnContext: { ppt: turnPpt }, isQueued: true })
    stored.ppt = { ...ppt, brandColor: '#abcdef' }
    await saveSession(stored)
    const reopened = loadSession(root, created.id)!
    expect(reopened.ppt).toEqual(stored.ppt)
    expect(reopened.messages[0]?.content).toBe('自然语言要求不变')
    expect(reopened.messages[0]?.turnContext?.ppt).toEqual(turnPpt)
    expect(listSessions(root).find(item => item.id === created.id)).toMatchObject({ workMode: 'PRO', ppt: stored.ppt })
    const file = getSessionFilePath(root, created.id)
    expect(readSessionHeader(file)?.ppt).toEqual(stored.ppt)
    expect((await readSessionHeaderAsync(file))?.ppt).toEqual(stored.ppt)
    // An ordinary short header must still terminate before reading message payload.
    const ordinary = await createSession(root)
    expect(readSessionHeader(getSessionFilePath(root, ordinary.id))?.id).toBe(ordinary.id)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
