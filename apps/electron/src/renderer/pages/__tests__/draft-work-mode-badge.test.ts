import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('draft chat header work-mode badge', () => {
  it('does not show the fixed work-mode badge before a session exists', () => {
    const chatPage = readFileSync(join(import.meta.dir, '../ChatPage.tsx'), 'utf8')
    // A draft has no sessionId, so canHandover is always false. Without the
    // isDraft guard the "work mode fixed" NORM badge leaked onto the empty
    // new-chat screen even though no session had been created yet.
    expect(chatPage).toContain("{!isDraft && !canHandover && currentWorkMode !== 'PRO' && <span")
  })
})
