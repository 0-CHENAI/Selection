import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('new session navigation', () => {
  it('opens the draft composer with auto-select suppressed', () => {
    const appShell = read('../AppShell.tsx')
    expect(appShell).toContain('draftSessionNavigateOptions(newPanel)')
    expect(appShell).toContain('navigate(routes.view.allSessions(), draftSessionNavigateOptions(newPanel))')
  })

  it('forwards skipAutoSelect through the navigate event bridge', () => {
    const navigation = read('../../../contexts/NavigationContext.tsx')
    expect(navigation).toContain('navigateOptionsFromEventDetail(customEvent.detail)')
    expect(navigation).not.toContain('navigate(r, newPanel ? { newPanel, targetLaneId } : undefined)')
  })
})
