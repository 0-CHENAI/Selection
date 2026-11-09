import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { OFFICE_CASE_PREVIEW_SESSION } from '@craft-agent/shared/protocol'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'
import { SessionManager, createManagedSession } from './SessionManager'
import { removeOfficeCasePreviews } from '../services/office-case-preview'

const binary = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'office-case-session-'))
  const workspace = { id: `case-ws-${Date.now()}`, name: 'Office', rootPath: join(root, 'workspace') }
  mkdirSync(workspace.rootPath)
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const manager = new SessionManager(), internal = manager as any
  const chat = createManagedSession({ id: 'chat', workMode: 'NORM', permissionMode: 'allow-all', workingDirectory: workspace.rootPath }, workspace as never, { messagesLoaded: true })
  const other = createManagedSession({ id: 'other', workMode: 'NORM', permissionMode: 'allow-all', workingDirectory: workspace.rootPath }, workspace as never, { messagesLoaded: true })
  internal.sessions.set(chat.id, chat); internal.sessions.set(other.id, other)
  cleanups.push(() => { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) },
    () => internal.officePreviews.dispose(),
    () => removeOfficeCasePreviews(workspace.id, OFFICE_CASE_PREVIEW_SESSION),
    () => removeOfficeCasePreviews(workspace.id, chat.id))
  return { manager, workspace, chat }
}

test('the empty home previews only bundled case samples', async () => {
  const { manager, workspace } = setup()
  const prepared = (await manager.officeHomePreview({ type: 'prepareCase', sessionId: OFFICE_CASE_PREVIEW_SESSION, caseId: 'coffee-market' }, workspace.id))!
  expect(prepared.readOnly).toBe(true)
  expect(prepared.path.endsWith('中国现制咖啡市场调研报告.docx')).toBe(true)
  const own = join(workspace.rootPath, 'mine.docx')
  writeFileSync(own, 'x')
  await expect(manager.officeHomePreview({ type: 'open', sessionId: OFFICE_CASE_PREVIEW_SESSION, path: own }, workspace.id)).rejects.toThrow('只能预览案例样例')
  await expect(manager.officeHomePreview({ type: 'open', sessionId: OFFICE_CASE_PREVIEW_SESSION, path: prepared.path }, 'another-workspace')).rejects.toThrow('只能预览案例样例')
  await expect(manager.officeHomePreview({ type: 'select', sessionId: OFFICE_CASE_PREVIEW_SESSION, previewId: 'x', paths: ['/body/p[1]'] }, workspace.id)).rejects.toThrow('仅供预览')
  await expect(manager.officeHomePreview({ type: 'prepareCase', sessionId: OFFICE_CASE_PREVIEW_SESSION, caseId: '../../etc' }, workspace.id)).rejects.toThrow('不存在')
})

test('a chat opens its own sample copy and no other chat can', async () => {
  const { manager, chat } = setup()
  const prepared = (await manager.officePreview({ type: 'prepareCase', sessionId: chat.id, caseId: 'port-cargo' }))!
  // Outside the workspace, so a different chat falls back to the normal workspace check and fails.
  await expect(manager.officePreview({ type: 'open', sessionId: 'other', path: prepared.path })).rejects.toThrow()
})

test.skipIf(!binary)('real OfficeCLI: home and chat sample previews are read-only', async () => {
  const { manager, workspace, chat } = setup()
  const home = (await manager.officeHomePreview({ type: 'prepareCase', sessionId: OFFICE_CASE_PREVIEW_SESSION, caseId: 'government-notice' }, workspace.id, 'client'))!
  const opened = (await manager.officeHomePreview({ type: 'open', sessionId: OFFICE_CASE_PREVIEW_SESSION, path: home.path }, workspace.id, 'client'))!
  expect(opened.readOnly).toBe(true)
  expect(opened.html).toContain('质量安全月')
  const refreshed = (await manager.officeHomePreview({ type: 'refresh', sessionId: OFFICE_CASE_PREVIEW_SESSION, previewId: opened.previewId }, workspace.id, 'client'))!
  expect(refreshed.previewId).toBe(opened.previewId)
  await expect(manager.officeHomePreview({ type: 'capture', sessionId: OFFICE_CASE_PREVIEW_SESSION, previewId: opened.previewId }, workspace.id, 'client')).rejects.toThrow('仅供预览')

  const inChat = (await manager.officePreview({ type: 'prepareCase', sessionId: chat.id, caseId: 'government-notice' }, 'client'))!
  const chatPreview = (await manager.officePreview({ type: 'open', sessionId: chat.id, path: inChat.path }, 'client'))!
  expect(chatPreview.readOnly).toBe(true)
  expect(chatPreview.artifactId).toBe('office-case:government-notice')
  await expect(manager.officePreview({ type: 'select', sessionId: chat.id, previewId: chatPreview.previewId, paths: ['/body/p[1]'] }, 'client')).rejects.toThrow('仅供预览')
  expect((await manager.officePreview({ type: 'refresh', sessionId: chat.id, previewId: chatPreview.previewId }, 'client'))!.previewId).toBe(chatPreview.previewId)
}, 90_000)
