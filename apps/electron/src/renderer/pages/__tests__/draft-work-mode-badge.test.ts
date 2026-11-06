import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('draft chat header work-mode badge', () => {
  it('does not show a fixed work-mode badge; NORM/PRO is the top-bar strategy switch', () => {
    const chatPage = readFileSync(join(import.meta.dir, '../ChatPage.tsx'), 'utf8')
    expect(chatPage).not.toContain('session.workModeFixed')
    expect(chatPage).not.toContain('canHandover')
    expect(chatPage).toContain('HandoverPanel')
    expect(chatPage).not.toContain('canCreate=')
  })
})
