import { describe, expect, it } from 'bun:test'

import {
  APP_DISPLAY_NAME,
  GIT_COAUTHOR_EMAIL,
  GIT_COAUTHOR_TRAILER,
  LEGACY_CRAFT_GIT_COAUTHOR_EMAILS,
  formatGitHubAttributionPrompt,
} from '../branding.ts'

describe('GitHub attribution identity', () => {
  it('uses Selection with an email GitHub will not map to craft-agents-bot', () => {
    expect(APP_DISPLAY_NAME).toBe('Selection')
    expect(GIT_COAUTHOR_EMAIL).toBe('selection-agent@users.noreply.github.com')
    expect(GIT_COAUTHOR_TRAILER).toBe(
      'Co-Authored-By: Selection <selection-agent@users.noreply.github.com>',
    )
    expect(GIT_COAUTHOR_EMAIL).not.toContain('craft.do')
    for (const email of LEGACY_CRAFT_GIT_COAUTHOR_EMAILS) {
      expect(email).toContain('craft.do')
      expect(GIT_COAUTHOR_EMAIL).not.toBe(email)
      expect(GIT_COAUTHOR_TRAILER).not.toContain(email)
    }
  })

  it('emits the Selection trailer only when co-author attribution is enabled', () => {
    const enabled = formatGitHubAttributionPrompt(true)
    const disabled = formatGitHubAttributionPrompt(false)

    expect(enabled).toContain('## Git Conventions')
    expect(enabled).toContain(GIT_COAUTHOR_TRAILER)
    expect(enabled).toContain('GitHub pull request, issue, or comment bodies')
    expect(enabled).toContain('never Craft Agent, Craft Agents, or craft-agents-bot')

    expect(disabled).toBe('')

    for (const block of [enabled, disabled]) {
      for (const email of LEGACY_CRAFT_GIT_COAUTHOR_EMAILS) {
        expect(block).not.toContain(`<${email}>`)
      }
      expect(block).not.toContain('Co-Authored-By: Craft Agent')
    }
  })
})
