import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveOrchestrationEditorTarget } from '../orchestration-editor-target'

describe('resolveOrchestrationEditorTarget (#261)', () => {
  it('keeps an edit target from chat or history', () => {
    const edit = { mode: 'edit' as const, sessionId: 's1', taskSlug: 'auth' }
    expect(resolveOrchestrationEditorTarget(edit, 'proj-a')).toEqual(edit)
  })

  it('opens create bound to the current sidebar project', () => {
    expect(resolveOrchestrationEditorTarget(null, 'proj-a')).toEqual({
      mode: 'create',
      initialProjectId: 'proj-a',
    })
  })

  it('opens an unbound create from the global list', () => {
    expect(resolveOrchestrationEditorTarget(null, null)).toEqual({ mode: 'create' })
    expect(resolveOrchestrationEditorTarget(null, undefined)).toEqual({ mode: 'create' })
  })
})

describe('kanban board UI is removed (#261)', () => {
  it('keeps the switcher and editor host, without columns or tiles', () => {
    const dir = join(import.meta.dir, '..')
    const container = readFileSync(join(dir, 'KanbanBoardContainer.tsx'), 'utf8')
    const toggle = readFileSync(join(dir, 'BoardListToggle.tsx'), 'utf8')
    const appShell = readFileSync(join(import.meta.dir, '../../AppShell.tsx'), 'utf8')

    expect(container).toContain('TaskEditor')
    expect(container).toContain('BoardListToggle')
    expect(container).toContain('resolveOrchestrationEditorTarget')
    expect(container).not.toContain("from './KanbanBoard'")
    expect(container).not.toContain('KanbanProjectFilter')
    expect(container).not.toContain("sessionStatus: 'todo'")
    expect(toggle).toContain("t('kanban.list')")
    expect(toggle).toContain("t('kanban.board')")
    expect(toggle).toContain('PenLine')
    expect(appShell).toContain('BoardListToggle')
    expect(appShell).toContain('orchestrationProjectId')
  })
})
