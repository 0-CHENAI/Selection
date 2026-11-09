import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Full Takeover risk dialog interpolates the mode's own localized name.
 * It must never fall back to the internal English `PERMISSION_MODE_CONFIG`
 * label ("Full Takeover" in every language).
 */
const LOCALES_DIR = join(import.meta.dir, '../locales')
const LOCALES = ['en', 'zh-Hans', 'de', 'es', 'hu', 'ja', 'pl'] as const

const read = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf-8'))

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => vars[name] ?? `{{${name}}}`)
}

describe('Full Takeover dialog localization', () => {
  for (const lang of LOCALES) {
    it(`${lang} names the mode in its own language via {{mode}}`, () => {
      const messages = read(lang)
      const mode = messages['mode.allow-all']!
      expect(mode).toBeTruthy()

      for (const key of ['dialog.fullTakeover.title', 'dialog.fullTakeover.message', 'dialog.fullTakeover.confirm']) {
        const rendered = interpolate(messages[key]!, { mode })
        expect(rendered).not.toContain('{{')
        expect(rendered).toContain(mode)
      }
    })
  }

  it('uses the localized mode name rather than the internal English label', () => {
    // Guard the regression seen in-app: a zh-Hans dialog reading "Full Takeover".
    const zh = read('zh-Hans')
    expect(zh['mode.allow-all']).toBe('完全接管')
    const title = interpolate(zh['dialog.fullTakeover.title']!, { mode: zh['mode.allow-all']! })
    expect(title).toBe('确认启用「完全接管」？')
    expect(title).not.toContain('Full Takeover')
  })
})
