import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const settingsDir = join(import.meta.dir, '..')
const legacyShortcuts = join(import.meta.dir, '../../ShortcutsPage.tsx')
const headerMenu = join(import.meta.dir, '../../../components/ui/HeaderMenu.tsx')

function pageSources(): string[] {
  return [
    ...readdirSync(settingsDir)
      .filter((name) => name.endsWith('Page.tsx'))
      .map((name) => readFileSync(join(settingsDir, name), 'utf8')),
    readFileSync(legacyShortcuts, 'utf8'),
  ]
}

describe('settings header menus (#380)', () => {
  it('deletes HeaderMenu instead of hiding the leftover more button', () => {
    expect(existsSync(headerMenu)).toBe(false)
  })

  it('removes the more button from every settings window header', () => {
    for (const source of pageSources()) {
      expect(source).not.toContain('HeaderMenu')
      expect(source).not.toContain('sessionMenu.openInNewWindow')
    }
  })
})
