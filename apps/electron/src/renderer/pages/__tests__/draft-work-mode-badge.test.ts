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

  it('animates the composer PRO badge on same-session mode switch instead of hard-mounting it', () => {
    const badge = readFileSync(join(import.meta.dir, '../../components/app-shell/SessionModeBadge.tsx'), 'utf8')
    const input = readFileSync(join(import.meta.dir, '../../components/app-shell/input/FreeFormInput.tsx'), 'utf8')
    expect(input).toContain('{!pptMode && <SessionModeBadge mode={workMode} />}')
    expect(badge).toContain('addSessionModeBadgeReveal')
    expect(badge).toContain('timeline.reverse()')
    expect(badge).toContain("mode === 'PRO'")
  })
})
