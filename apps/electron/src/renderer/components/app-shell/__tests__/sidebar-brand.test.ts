import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('sidebar Selection brand', () => {
  it('stays above the relocated new-session action', () => {
    const appShell = readFileSync(join(import.meta.dir, '..', 'AppShell.tsx'), 'utf8')
    const brandPosition = appShell.indexOf('<SelectionSidebarBrand />')
    const newSessionPosition = appShell.indexOf('data-tutorial="new-chat-button"')

    expect(brandPosition).toBeGreaterThan(-1)
    expect(newSessionPosition).toBeGreaterThan(brandPosition)
  })

  it('does not duplicate the brand in the conversation pane', () => {
    const chatDisplay = readFileSync(join(import.meta.dir, '..', 'ChatDisplay.tsx'), 'utf8')
    expect(chatDisplay).not.toContain('SelectionSidebarBrand')
    expect(chatDisplay).not.toContain('selection-sidebar-brand')
  })
})
