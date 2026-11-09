import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

describe('AppearanceSettingsPage (#307)', () => {
  const source = readFileSync(join(import.meta.dir, '../AppearanceSettingsPage.tsx'), 'utf8')

  it('keeps the remaining appearance sections without the tool icons block', () => {
    expect(source).toContain('settings.appearance.defaultTheme')
    expect(source).toContain('settings.appearance.workspaceThemes')
    expect(source).toContain('settings.appearance.interface')
    expect(source).not.toContain('settings.appearance.toolIcons')
    expect(source).not.toContain('getToolIconMappings')
    expect(source).not.toContain('getToolIconColumns')
    expect(source).not.toContain('Info_DataTable')
    expect(source).not.toContain('edit-tool-icons')
  })

  it('drops tool icons from the settings navigator description', () => {
    const en = LOCALE_REGISTRY.en.messages
    const zhHans = LOCALE_REGISTRY['zh-Hans'].messages
    expect(en['settings.appearance.description']).toBe('Theme, font, and interface')
    expect(zhHans['settings.appearance.description']).toBe('主题、字体与界面')
    expect(en['settings.appearance.description']).not.toMatch(/tool icon/i)
    expect(zhHans['settings.appearance.description']).not.toContain('工具图标')
  })
})
