import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OfficeDocumentState } from '../../protocol/office'
import { createSession, listSessions, loadSession, saveSession } from '../storage'

test('Word selection and its injection fingerprint survive save, reload and a hidden injection message', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'office-session-')))
  try {
    const office: OfficeDocumentState = {
      mode: 'word',
      templateId: 'meeting-minutes',
      revision: '20261012.1',
      injectionFingerprint: 'word:meeting-minutes@20261012.1',
    }
    const created = await createSession(root, { office, workMode: 'NORM' })
    expect(created.workMode).toBe('NORM')
    expect(created.office).toEqual(office)
    const stored = loadSession(root, created.id)!
    stored.messages.push(
      {
        id: 'injection',
        type: 'user',
        content: 'office-docx 指南 meeting-minutes@20261012.1 meeting-recap',
        hidden: true,
        officeInjection: { source: 'selection-office-composer', fingerprint: office.injectionFingerprint!, status: 'active' },
        timestamp: 1,
      },
      { id: 'user', type: 'user', content: '请整理会议', timestamp: 2 },
    )
    await saveSession(stored)
    const reopened = loadSession(root, created.id)!
    expect(reopened.office).toEqual(office)
    expect(reopened.workMode).toBe('NORM')
    expect(reopened.messages[0]?.officeInjection).toEqual({
      source: 'selection-office-composer',
      fingerprint: 'word:meeting-minutes@20261012.1',
      status: 'active',
    })
    expect(reopened.messages[0]?.hidden).toBe(true)
    expect(listSessions(root).find(item => item.id === created.id)?.preview).toBe('请整理会议')
    reopened.office = null
    await saveSession(reopened)
    expect(loadSession(root, created.id)?.office).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
