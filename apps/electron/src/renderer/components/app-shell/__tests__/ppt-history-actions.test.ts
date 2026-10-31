import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('PPT history session actions', () => {
  it('reuses the ordinary session menu, rename dialog, and delete path', () => {
    const list = read('../PptHistoryList.tsx')
    expect(list).toContain('<SessionMenu')
    expect(list).toContain('<CompactSessionMenu')
    expect(list).toContain('<RenameDialog')
    expect(list).toContain('useSessionActions')
    expect(list).toContain('handleDeleteWithToast')
    expect(list).toContain('nextPptHistoryId')
    expect(list).not.toContain('Trash2')
    expect(list).not.toContain('confirmAction(')
  })

  it('keeps a missing Office session inside the Office navigator', () => {
    const appShell = read('../AppShell.tsx')
    expect(appShell).toContain('nextPptHistoryId(')
    expect(appShell).toContain('if (!isOfficeArea)')
    expect(appShell).toContain('navigate(next ? officeSessionRoute(next) : routes.view.office(officeHomeSection), next ? undefined : draftSessionNavigateOptions())')
  })

  it('opens an Office session in a new panel on its own route', () => {
    const actions = read('../../../hooks/useSessionMenuActions.ts')
    expect(actions).toContain('officeSessionSection(item) ? officeSessionRoute(item) : routes.view.allSessions(sessionId)')
  })
})
