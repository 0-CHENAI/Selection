import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { constrainThinkingLevel, modelThinkingLevels, resolveSessionThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('draft to live session composer', () => {
  it('keeps inherited directories out of explicit creation overrides (#406)', () => {
    const chatPage = read('../ChatPage.tsx')
    // Both the initial submission and draft-reset submission call the same factory.
    // Project drafts defer to the server so an inherited folder is not an explicit override.
    expect(chatPage.match(/workingDirectory: orchestrationProjectId \? 'user_default' : draftWorkingDirectoryOverride,/g)).toHaveLength(2)
    expect(chatPage.match(/createCurrentDraftRef\.current\(\)/g)).toHaveLength(2)
    expect(chatPage.match(/workingDirectory: ctx.workingDirectory \?\? 'user_default'/g)).toHaveLength(1)
    expect(chatPage).toContain('workspaceWorkingDirectory: settings?.workingDirectory')
    expect(chatPage).not.toContain('setDraftWorkingDirectory(settings.workingDirectory)')
    expect(chatPage).toContain('projects.find(project => project.config.id === orchestrationProjectId)')
    expect(chatPage).toContain('draftProject?.config.workingDirectory')
    expect(chatPage).toContain('draftSessionOptionsId(activeWorkspaceId')
  })

  it('does not offer a slash-menu folder switch inside a project conversation', () => {
    const input = read('../../components/app-shell/input/FreeFormInput.tsx')
    expect(input).toContain('recentFolders: workingDirectoryLocked ? NO_SLASH_FOLDERS : recentFolders')
    expect(input).toContain('const NO_SLASH_FOLDERS: string[] = []')
  })

  it('uses thinking defaults and persists user intent while displaying a model-specific legal level', () => {
    const chatPage = read('../ChatPage.tsx')
    expect(chatPage).toContain('window.electronAPI.getDefaultThinkingLevel()')
    expect(chatPage).toContain('draftStore.get(draftComposerAtomFamily(optionsSessionId)).thinkingSelection')
    expect(chatPage.match(/thinkingLevel: ctx\.thinkingLevel,/g)).toHaveLength(1)
    expect(chatPage).toContain('if (isDraft) setDraftComposer(previous => ({ ...previous, thinkingSelection: level }))')
    expect(chatPage).toContain('resolveSessionThinkingLevel(activeThinkingModel, sessionOpts.thinkingLevel)')
    expect(chatPage).not.toContain('draftCreateRef.current.thinkingLevel = activeThinkingLevel')
    expect(chatPage.match(/thinkingLevel=\{activeThinkingLevel\}/g)).toHaveLength(2)
    expect(chatPage).not.toContain('handleThinkingLevelChange(activeThinkingLevel)')
    expect(chatPage.match(/thinkingLevel: sessionOpts.thinkingLevel,/g)).toHaveLength(2)
  })

  it('maps an unsupported saved default to the level shown for the selected model', () => {
    const supported = modelThinkingLevels({ supportedThinkingLevels: ['low', 'high', 'max'] })
      .map(level => level.id)
    expect(constrainThinkingLevel('medium', supported)).toBe('low')
    expect(constrainThinkingLevel('high', supported)).toBe('high')
    expect(resolveSessionThinkingLevel({ id: 'gpt-4o' }, 'high')).toBe('off')
    expect(resolveSessionThinkingLevel({ id: 'claude-haiku-4-5-20251001' }, 'max')).toBe('high')
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
