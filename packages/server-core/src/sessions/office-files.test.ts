import { expect, test, spyOn } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { createManagedSession, SessionManager } from './SessionManager'

test('Office discovery sees the selected working directory and current session files, uploads and deliveries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-files-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: join(root, 'workspace') }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const put = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'document'); return path }
  try {
    const report = put(join(workspace.rootPath, 'reports', 'unrelated.DOCX'))
    put(join(workspace.rootPath, 'sheet.xlsx'))
    put(join(workspace.rootPath, 'sessions', 'other', 'slides.pptx'))
    const sessionFile = put(join(workspace.rootPath, 'sessions', 'parent', 'report.docx'))
    const sessionDownload = put(join(workspace.rootPath, 'sessions', 'parent', 'downloads', 'slides.pptx'))
    const delivery = put(join(workspace.rootPath, 'published', 'delivered.docx'))
    const cwd = join(root, 'project'), projectFile = put(join(cwd, 'budget.xlsx'))
    const upload = put(join(root, 'uploads', 'attachment.docx'))
    const outside = put(join(root, 'outside.docx'))
    for (const path of ['sessions/parent/~$report.docx', 'sessions/parent/.hidden.docx', 'sessions/parent/legacy.doc', 'sessions/parent/node_modules/fixture.docx',
      'artifacts/versions/snapshot.docx', 'sessions/child/result.docx', 'sessions/parent/candidate/result.docx',
      'sessions/parent/data/qa.docx', 'sessions/parent/plans/plan.docx']) put(join(workspace.rootPath, path))
    symlinkSync(outside, join(cwd, 'escape.docx'))
    symlinkSync(report, join(cwd, 'unrelated.docx'))
    symlinkSync(sessionFile, join(workspace.rootPath, 'sessions', 'parent', 'alias.docx'))
    symlinkSync(workspace.rootPath, join(cwd, 'loop'))
    const manager = new SessionManager(), internal = manager as any
    const parent = createManagedSession({ id: 'parent', workingDirectory: cwd }, workspace as never, { messagesLoaded: true })
    parent.messages = [{ id: 'upload', role: 'user', content: '附件', timestamp: 1,
      attachments: [{ id: 'file', name: 'attachment.docx', type: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 8, storedPath: upload }] },
      { id: 'delivery', role: 'assistant', content: '交付', timestamp: 2, artifactVersions: [{ path: delivery } as never] }]
    internal.sessions.set(parent.id, parent)
    internal.sessions.set('child', createManagedSession({ id: 'child', hidden: true, parentSessionId: 'parent' }, workspace as never, { messagesLoaded: true }))
    const expected = [sessionFile, sessionDownload, delivery, projectFile, upload].map(path => realpathSync(path)).sort((a, b) => a.localeCompare(b))
    expect(await manager.getOfficeFiles(parent.id)).toEqual(expected)
    const removedFile = realpathSync(projectFile)
    unlinkSync(projectFile)
    expect(await manager.getOfficeFiles(parent.id)).toEqual(expected.filter(path => path !== removedFile))
    await expect(manager.getOfficeFiles('child')).rejects.toThrow('active parent chat')
    await expect(manager.getOfficeFiles('missing')).rejects.toThrow('active parent chat')
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('without a selected working directory, unrelated workspace and sibling files cannot enable Office collaboration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-files-session-scope-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  try {
    const parentDirectory = join(root, 'sessions', 'parent')
    mkdirSync(parentDirectory, { recursive: true })
    mkdirSync(join(root, 'sessions', 'other'), { recursive: true })
    writeFileSync(join(root, 'unrelated.docx'), 'document')
    writeFileSync(join(root, 'sessions', 'other', 'unrelated.xlsx'), 'document')
    const manager = new SessionManager(), internal = manager as any
    internal.sessions.set('parent', createManagedSession({ id: 'parent' }, workspace as never, { messagesLoaded: true }))
    expect(await manager.getOfficeFiles('parent')).toEqual([])
    const ownedFile = join(parentDirectory, 'report.docx')
    writeFileSync(ownedFile, 'document')
    expect(await manager.getOfficeFiles('parent')).toEqual([realpathSync(ownedFile)])
    unlinkSync(ownedFile)
    expect(await manager.getOfficeFiles('parent')).toEqual([])
  } finally { lookup.mockRestore(); rmSync(root, { recursive: true, force: true }) }
})

test('a selected working directory containing application storage still excludes other sessions, including unloaded ones', async () => {
  const root = mkdtempSync(join(tmpdir(), 'office-files-overlapping-scope-'))
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace as never)
  const put = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'document'); return realpathSync(path) }
  try {
    const projectFile = put(join(root, 'report.docx'))
    const sessionFile = put(join(root, 'sessions', 'parent', 'slides.pptx'))
    for (const path of ['sessions/loaded/report.docx', 'sessions/unloaded/report.docx', 'sessions/child/report.docx',
      'sessions/parent/candidate/draft.docx', 'sessions/parent/data/qa.docx', 'sessions/parent/plans/plan.docx',
      'artifacts/versions/cache.docx', 'artifacts/feedback/candidate.docx']) put(join(root, path))
    const manager = new SessionManager(), internal = manager as any
    internal.sessions.set('parent', createManagedSession({ id: 'parent', workingDirectory: root }, workspace as never, { messagesLoaded: true }))
    internal.sessions.set('loaded', createManagedSession({ id: 'loaded' }, workspace as never, { messagesLoaded: true }))
    internal.sessions.set('child', createManagedSession({ id: 'child', hidden: true, parentSessionId: 'parent' }, workspace as never, { messagesLoaded: true }))
    expect(await manager.getOfficeFiles('parent')).toEqual([projectFile, sessionFile].sort((a, b) => a.localeCompare(b)))
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
