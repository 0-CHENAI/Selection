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

  it('keeps a missing PPT session inside the PPT navigator', () => {
    const appShell = read('../AppShell.tsx')
    expect(appShell).toContain('nextPptHistoryId(')
    expect(appShell).toContain('navigate(nextId ? routes.view.ppt(nextId) : routes.view.ppt(), nextId ? undefined : draftSessionNavigateOptions())')
    expect(appShell).toContain('if (!isPptView)')
  })

  it('opens a PPT session in a new panel on the PPT route', () => {
    const actions = read('../../../hooks/useSessionMenuActions.ts')
    expect(actions).toContain("item.ppt !== undefined ? routes.view.ppt(sessionId) : routes.view.allSessions(sessionId)")
  })
})
