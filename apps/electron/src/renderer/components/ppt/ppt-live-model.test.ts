import { describe, expect, it } from 'bun:test'
import { applyPptSelection, pptHistoryKind, PPT_LIVE_MAX_SELECTION } from './ppt-live-model'

describe('PPT live selection', () => {
  it('replaces on click, clears a repeated click, and toggles without mixing a page and its elements', () => {
    const page = { page: 3 }
    const element = { page: 3, elementId: 'title' }
    expect(applyPptSelection([], page, false)).toEqual([page])
    expect(applyPptSelection([page], page, false)).toEqual([])
    const both = applyPptSelection([page], { page: 4 }, true)
    expect(both).toEqual([page, { page: 4 }])
    expect(applyPptSelection(both, element, true).some(target => target.page === 3 && !target.elementId)).toBe(false)
    expect(applyPptSelection([{ page: 3, elementId: 'title' }, { page: 3, elementId: 'chart' }], page, true)).toEqual([page])
  })

  it('stops at the office selection limit', () => {
    const full = Array.from({ length: PPT_LIVE_MAX_SELECTION }, (_, index) => ({ page: index + 1 }))
    expect(applyPptSelection(full, { page: 500 }, true)).toHaveLength(PPT_LIVE_MAX_SELECTION)
  })

  it('describes history progress from the persisted deck counts', () => {
    expect(pptHistoryKind({ processing: true, progress: { total: 17, completed: 8, current: 9, generating: true } })).toEqual({ kind: 'progress', current: 9, total: 17 })
    expect(pptHistoryKind({ processing: true })).toEqual({ kind: 'generating' })
    expect(pptHistoryKind({ progress: { total: 17, completed: 17, generating: false }, templatePages: 12 })).toEqual({ kind: 'pages', count: 17 })
    expect(pptHistoryKind({ templatePages: 12 })).toEqual({ kind: 'pages', count: 12 })
    expect(pptHistoryKind({})).toEqual({ kind: 'file' })
  })
})
