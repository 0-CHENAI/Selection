import { describe, expect, it } from 'bun:test'
import { pptHistoryKind } from './history'

describe('PPT history progress', () => {
  it('describes history progress from the persisted deck counts', () => {
    expect(pptHistoryKind({ processing: true, progress: { total: 17, completed: 8, current: 9, generating: true } })).toEqual({ kind: 'progress', current: 9, total: 17 })
    expect(pptHistoryKind({ processing: true })).toEqual({ kind: 'generating' })
    expect(pptHistoryKind({ processing: true, progress: { total: 0, completed: 0, generating: true } })).toEqual({ kind: 'generating' })
    expect(pptHistoryKind({ progress: { total: 17, completed: 17, generating: false }, templatePages: 12 })).toEqual({ kind: 'pages', count: 17 })
    expect(pptHistoryKind({ templatePages: 12 })).toEqual({ kind: 'pages', count: 12 })
    expect(pptHistoryKind({})).toEqual({ kind: 'file' })
  })
})
