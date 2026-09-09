import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
})
