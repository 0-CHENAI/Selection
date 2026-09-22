import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('draft to live session composer', () => {
  it('keeps inherited directories out of explicit creation overrides (#406)', () => {
    const chatPage = read('../ChatPage.tsx')
    // Both the initial submission and draft-reset submission read this ref.
    expect(chatPage.match(/workingDirectory: draftWorkingDirectoryOverride,/g)).toHaveLength(2)
    expect(chatPage.match(/workingDirectory: ctx.workingDirectory \?\? 'user_default'/g)).toHaveLength(2)
    expect(chatPage).toContain('setWorkspaceWorkingDirectory(settings.workingDirectory)')
    expect(chatPage).not.toContain('setDraftWorkingDirectory(settings.workingDirectory)')
    expect(chatPage).toContain('projects.find(project => project.config.id === orchestrationProjectId)?.config.workingDirectory')
    expect(chatPage).toContain('[isDraft, activeWorkspaceId, orchestrationProjectId, setPermissionMode, setOption]')
  })

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
