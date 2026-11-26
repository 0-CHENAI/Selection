import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('session menus', () => {
  it.each([
    ['SessionMenu.tsx', 'onClick={actions.bindToLark}'],
    ['CompactSessionMenu.tsx', 'closeAfter(actions.bindToLark)'],
  ])('%s exposes the shared Feishu binding action', (file, action) => {
    const source = readFileSync(join(import.meta.dir, '..', file), 'utf8')
    expect(source).toContain(action)
    expect(source).toContain("t('sessionMenu.bindToLark')")
    expect(source).not.toMatch(/telegram|whatsapp/i)
  })
})
