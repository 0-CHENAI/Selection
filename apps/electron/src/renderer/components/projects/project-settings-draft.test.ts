import { describe, expect, it } from 'bun:test'
import { mergeProjectSettingsRefresh, projectSettingsDraftDirty, projectSettingsDraftFromConfig } from './project-settings-draft'

describe('project settings draft', () => {
  it('treats a loaded config and an untouched form as clean', () => {
    const stored = projectSettingsDraftFromConfig({
      name: '巡察',
      workingDirectory: '/data/巡察',
      historySearchEnabled: false,
    })
    expect(projectSettingsDraftDirty(stored, { ...stored })).toBe(false)
  })

  it('keeps an unsaved folder choice distinct from the stored config', () => {
    const stored = projectSettingsDraftFromConfig({ name: '巡察', workingDirectory: '/data/old' })
    expect(projectSettingsDraftDirty(stored, { ...stored, workingDirectory: '/data/new' })).toBe(true)
    expect(projectSettingsDraftDirty(stored, { ...stored, name: '巡察二期' })).toBe(true)
  })

  it('keeps local edits and adopts remote changes to untouched fields', () => {
    const previous = projectSettingsDraftFromConfig({
      name: '巡察',
      description: '旧说明',
      workingDirectory: '/data/old',
      color: '#111111',
    })
    const incoming = projectSettingsDraftFromConfig({
      name: '巡察',
      description: '远端说明',
      workingDirectory: '/data/old',
      color: '#222222',
    })
    const draft = { ...previous, name: '巡察二期', workingDirectory: '/data/new' }
    expect(mergeProjectSettingsRefresh(previous, incoming, draft)).toEqual({
      ...incoming,
      name: '巡察二期',
      workingDirectory: '/data/new',
    })
  })
})
