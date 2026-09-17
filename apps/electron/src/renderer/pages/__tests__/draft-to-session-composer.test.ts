import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('draft to live session composer', () => {
  it('keeps ChatPage mounted so the composer is not swapped on first send', () => {
    const panel = read('../../components/app-shell/MainContentPanel.tsx')
    const chatPage = read('../ChatPage.tsx')
    const chatDisplay = read('../../components/app-shell/ChatDisplay.tsx')

    expect(panel).toContain('sessionId={navState.details?.sessionId ?? null}')
    expect(panel).not.toContain('DraftChatPage')
    expect(chatPage).toContain('sessionId: string | null')
    expect(chatPage).toContain('session={displaySession ?? draftSession}')
    expect(chatPage).toContain('composerSessionId={sessionId}')
    expect(chatPage).toContain('createDraftDisplaySession')
    expect(chatDisplay).toContain('composerSessionId?: string | null')
    expect(chatDisplay).toContain('composerSessionId !== undefined ? composerSessionId ?? undefined : session.id')
  })
})
