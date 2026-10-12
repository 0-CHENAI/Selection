import { expect, test, spyOn } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { createManagedSession, SessionManager } from './SessionManager'

test('Office discovery sees workspace files, the current project and uploads while excluding private drafts and symlink escapes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-files-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: join(root, 'workspace') }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const put = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'document'); return path }
  try {
    const report = put(join(workspace.rootPath, 'reports', 'report.DOCX'))
    const sheet = put(join(workspace.rootPath, 'sheet.xlsx'))
    const deck = put(join(workspace.rootPath, 'sessions', 'other', 'slides.pptx'))
    const cwd = join(root, 'project'), projectFile = put(join(cwd, 'budget.xlsx'))
    const upload = put(join(root, 'uploads', 'attachment.docx'))
    const outside = put(join(root, 'outside.docx'))
    for (const path of ['~$report.docx', '.hidden.docx', 'legacy.doc', 'node_modules/fixture.docx',
      'artifacts/versions/snapshot.docx', 'sessions/child/result.docx', 'sessions/parent/candidate/result.docx',
      'sessions/parent/data/qa.docx', 'sessions/parent/plans/plan.docx']) put(join(workspace.rootPath, path))
    symlinkSync(outside, join(workspace.rootPath, 'escape.docx'))
    symlinkSync(report, join(workspace.rootPath, 'alias.docx'))
    symlinkSync(workspace.rootPath, join(workspace.rootPath, 'loop'))
    const manager = new SessionManager(), internal = manager as any
    const parent = createManagedSession({ id: 'parent', workingDirectory: cwd }, workspace as never, { messagesLoaded: true })
    parent.messages = [{ id: 'upload', role: 'user', content: '附件', timestamp: 1,
      attachments: [{ id: 'file', name: 'attachment.docx', type: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 8, storedPath: upload }] }]
    internal.sessions.set(parent.id, parent)
    internal.sessions.set('child', createManagedSession({ id: 'child', hidden: true, parentSessionId: 'parent' }, workspace as never, { messagesLoaded: true }))
    const expected = [report, sheet, deck, projectFile, upload].map(path => realpathSync(path)).sort((a, b) => a.localeCompare(b))
    expect(await manager.getOfficeFiles(parent.id)).toEqual(expected)
    unlinkSync(sheet)
    expect(await manager.getOfficeFiles(parent.id)).toEqual(expected.filter(path => !path.endsWith('sheet.xlsx')))
    await expect(manager.getOfficeFiles('child')).rejects.toThrow('active parent chat')
    await expect(manager.getOfficeFiles('missing')).rejects.toThrow('active parent chat')
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('a workspace without supported Office files returns no collaboration candidates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-files-empty-'))
  try {
    writeFileSync(join(root, 'notes.txt'), 'text')
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
    const manager = new SessionManager(), internal = manager as any
    internal.sessions.set('parent', createManagedSession({ id: 'parent' }, workspace as never, { messagesLoaded: true }))
    expect(await manager.getOfficeFiles('parent')).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
