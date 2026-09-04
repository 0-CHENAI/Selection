import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('desktop top bar entries (#262)', () => {
  it('removes the desktop brand menu, creation-jobs slot, and add-panel plus', () => {
    const topBar = read('../TopBar.tsx')
    const appMenuStart = topBar.indexOf('{isCompact && (')
    const appMenuTag = topBar.indexOf('<AppMenu')

    expect(appMenuStart).toBeGreaterThan(-1)
    expect(appMenuTag).toBeGreaterThan(appMenuStart)
    expect(topBar).toContain('BrowserTabStrip')
    expect(topBar).toContain('menu.toggleSidebar')
    expect(topBar).toContain('common.back')
    expect(topBar).toContain('common.forward')
    expect(topBar).toContain('WorkspaceSwitcher')
    expect(topBar).not.toContain('workspaceActivity')
    expect(topBar).not.toContain('onAddSessionPanel')
    expect(topBar).not.toContain('onAddBrowserPanel')
    expect(topBar).not.toContain('menu.addPanelMenu')
    expect(topBar).not.toContain('CreationJobsButton')
    expect(topBar).not.toContain('ListChecks')
    expect(topBar).not.toContain('menu.craftMenu')
  })

  it('keeps compact AppMenu props and does not leave empty add-panel wrappers', () => {
    const topBar = read('../TopBar.tsx')
    expect(topBar).toContain('onNewChat={onNewChat}')
    expect(topBar).toContain('onOpenSettings={onOpenSettings}')
    expect(topBar).not.toContain('session.newSessionInPanel')
    expect(topBar).not.toContain('browser.newWindow')
    expect(topBar).not.toContain('SquarePenRounded')
  })

  it('mounts creation-job validation off the top bar and keeps manage/stop on resource pages', () => {
    const appShell = read('../AppShell.tsx')
    const host = appShell.indexOf('<CreationJobsHost')
    const topBar = appShell.indexOf('<TopBar')
    const sources = appShell.indexOf('isSourcesNavigation(navState) && activeWorkspace')
    const skills = appShell.indexOf('isSkillsNavigation(navState) && activeWorkspace')
    const automations = appShell.indexOf('isAutomationsNavigation(navState) && activeWorkspace')
    const firstButton = appShell.indexOf('<CreationJobsButton')
    const secondButton = appShell.indexOf('<CreationJobsButton', firstButton + 1)
    const thirdButton = appShell.indexOf('<CreationJobsButton', secondButton + 1)

    expect(host).toBeGreaterThan(-1)
    expect(host).toBeLessThan(topBar)
    expect(appShell).toContain("useAction('app.newChatInPanel', () => handleNewChat(true))")
    expect(appShell).not.toContain('workspaceActivity')
    expect(appShell).not.toContain('onAddSessionPanel')
    expect(appShell).not.toContain('onAddBrowserPanel')
    expect(appShell).not.toContain('handleNewBrowserWindow')
    expect(firstButton).toBeGreaterThan(sources)
    expect(secondButton).toBeGreaterThan(skills)
    expect(thirdButton).toBeGreaterThan(automations)
  })

  it('runs creation-job reconciliation in the host, not the visual button', () => {
    const source = read('../CreationJobsButton.tsx')
    const host = source.slice(source.indexOf('export function CreationJobsHost'))
    const button = source.slice(source.indexOf('export function CreationJobsButton'))

    expect(host).toContain('useCreationJobReconciler')
    expect(host).toContain('return null')
    expect(button).not.toContain('useCreationJobReconciler')
    expect(button).toContain('creationJobs.title')
    expect(source).toContain('toast.success')
    expect(source).toContain('toast.error')
    expect(source).toContain('toast.info')
    expect(source).toContain('validateCreationJob')
    expect(source).toContain('shouldCancelCreationJob')
  })
})
