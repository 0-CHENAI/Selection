import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProject, loadProjectConfig, updateProject } from '../storage.ts'
import {
  applyWorkingDirectoryPatch,
  createProjectBlocker,
  folderNameFromPath,
  isProjectConversation,
  projectConversationDirectoryUpdates,
  projectWorkingDirectorySaveIssue,
  requiredProjectConversationDirectory,
  requireCreateProjectFields,
  suggestProjectNameFromFolder,
} from '../working-directory.ts'

describe('project working folder', () => {
  it('reads the folder name from a path', () => {
    expect(folderNameFromPath('/Users/demo/巡察资料/')).toBe('巡察资料')
    expect(folderNameFromPath('C:\\Work\\Reports')).toBe('Reports')
    expect(folderNameFromPath('   ')).toBe('')
  })

  it('prefills an empty name and keeps a name the user already typed', () => {
    expect(suggestProjectNameFromFolder({
      currentName: '',
      previousSuggestion: '',
      folderPath: '/data/巡察资料',
    })).toEqual({ name: '巡察资料', suggestion: '巡察资料' })

    expect(suggestProjectNameFromFolder({
      currentName: '巡察资料',
      previousSuggestion: '巡察资料',
      folderPath: '/data/另一文件夹',
    }).name).toBe('另一文件夹')

    expect(suggestProjectNameFromFolder({
      currentName: '我的项目',
      previousSuggestion: '巡察资料',
      folderPath: '/data/另一文件夹',
    }).name).toBe('我的项目')
  })

  it('blocks creation until a folder and a name are present', () => {
    expect(createProjectBlocker({ name: '巡察', workingDirectory: '' })).toBe('folder')
    expect(createProjectBlocker({ name: '  ', workingDirectory: '/data/巡察' })).toBe('name')
    expect(createProjectBlocker({ name: '巡察', workingDirectory: '/data/巡察' })).toBeNull()
    expect(() => requireCreateProjectFields({ name: '巡察' })).toThrow('Working directory is required')
    expect(() => requireCreateProjectFields({ name: ' ', workingDirectory: '/data/巡察' })).toThrow('Project name is required')
  })

  it('asks for a folder on a legacy project and refuses to clear a saved one', () => {
    expect(projectWorkingDirectorySaveIssue({
      storedWorkingDirectory: undefined,
      nextWorkingDirectory: '',
    })).toBe('missing')
    expect(projectWorkingDirectorySaveIssue({
      storedWorkingDirectory: '/data/巡察',
      nextWorkingDirectory: '   ',
    })).toBe('cleared')
    expect(projectWorkingDirectorySaveIssue({
      storedWorkingDirectory: '/data/巡察',
      nextWorkingDirectory: '/data/other',
    })).toBeNull()
  })

  it('persists a required folder and rejects clearing it', () => {
    const root = mkdtempSync(join(tmpdir(), 'project-folder-'))
    try {
      expect(() => createProject(root, { name: '巡察', workingDirectory: '   ' })).toThrow('Working directory is required')
      expect(() => createProject(root, { name: ' ', workingDirectory: '/data/巡察' })).toThrow('Project name is required')
      const created = createProject(root, { name: '巡察', workingDirectory: '/data/巡察资料' })
      expect(loadProjectConfig(root, created.slug)?.workingDirectory).toBe('/data/巡察资料')

      expect(() => updateProject(root, created.slug, { workingDirectory: '  ' })).toThrow('cannot be cleared')
      const renamed = updateProject(root, created.slug, { name: '巡察二期' })
      expect(renamed.workingDirectory).toBe('/data/巡察资料')
      expect(renamed.name).toBe('巡察二期')

      const legacyRoot = mkdtempSync(join(tmpdir(), 'project-folder-legacy-'))
      try {
        const legacy = createProject(legacyRoot, { name: '旧项目', workingDirectory: '/tmp/seed' })
        const configPath = join(legacyRoot, 'projects', legacy.slug, 'config.json')
        const stored = JSON.parse(readFileSync(configPath, 'utf8'))
        delete stored.workingDirectory
        writeLegacy(configPath, stored)
        const updated = updateProject(legacyRoot, legacy.slug, { description: '仍可保存' })
        expect(updated.description).toBe('仍可保存')
        expect(updated.workingDirectory).toBeUndefined()
        expect(projectWorkingDirectorySaveIssue({
          storedWorkingDirectory: updated.workingDirectory,
          nextWorkingDirectory: '',
        })).toBe('missing')
      } finally {
        rmSync(legacyRoot, { recursive: true, force: true })
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('locks project conversations to the project folder and leaves workers alone', () => {
    const conversation = { projectId: 'proj_1' }
    expect(isProjectConversation(conversation)).toBe(true)
    expect(isProjectConversation({ projectId: 'proj_1', hidden: true })).toBe(false)
    expect(isProjectConversation({ projectId: 'proj_1', parentSessionId: 'parent' })).toBe(false)
    expect(isProjectConversation({ projectId: 'proj_1', orchestrationRole: 'worker' })).toBe(false)
    expect(requiredProjectConversationDirectory(conversation, '/data/巡察')).toBe('/data/巡察')
    expect(requiredProjectConversationDirectory(conversation, '  ')).toBeUndefined()
    expect(requiredProjectConversationDirectory({ orchestrationRole: 'worker', projectId: 'proj_1' }, '/data/巡察')).toBeNull()
    expect(projectConversationDirectoryUpdates({
      projectId: 'proj_1',
      workingDirectory: '/data/巡察',
      sessions: [
        { id: 'chat', projectId: 'proj_1', workingDirectory: '/data/old' },
        { id: 'same', projectId: 'proj_1', workingDirectory: '/data/巡察' },
        { id: 'worker', projectId: 'proj_1', orchestrationRole: 'worker', workingDirectory: '/data/old' },
        { id: 'other', projectId: 'proj_2', workingDirectory: '/data/old' },
        { id: 'sandbox', projectId: 'proj_1', isolated: true, workingDirectory: '/tmp/sandbox' },
      ],
    })).toEqual(['chat'])
  })

  it('leaves a patch alone when it does not mention the folder', () => {
    expect(applyWorkingDirectoryPatch('/data/巡察', { name: '巡察' })).toEqual({ name: '巡察' })
  })

  it('keeps the new settings strings in every locale', () => {
    const required = [
      'projectInfo.settingsBasic',
      'projectInfo.settingsFolder',
      'projectInfo.settingsFolderMissing',
      'projectInfo.settingsFolderRequired',
      'projectInfo.settingsInstructions',
      'projectInfo.settingsRetrieval',
      'projectInfo.settingsDanger',
      'projectInfo.metadataSummary',
      'projectsList.createDialogFolderLabel',
      'projectsList.createDialogFolderRequired',
      'projectsList.createDialogFolderButton',
      'projectsList.createDialogNameRequired',
      'chat.projectWorkingDirectory',
      'chat.projectWorkingDirectoryMissing',
      'chat.projectWorkingDirectoryMissingHint',
    ]
    const dir = join(import.meta.dir, '..', '..', 'i18n', 'locales')
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThan(1)
    for (const file of files) {
      const messages = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>
      for (const key of required) {
        expect(messages[key]?.trim().length ?? 0).toBeGreaterThan(0)
      }
    }
  })
})

function writeLegacy(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2))
}
