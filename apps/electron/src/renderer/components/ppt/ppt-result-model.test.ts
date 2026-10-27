import { expect, test } from 'bun:test'
import { attentionCount, attentionPageNumbers, checkSummary, formatAttentionPages, pptLiveFrame, pptRowFraction, slidePreviewPath } from './ppt-result-model'
import type { PptPageProgress } from '@craft-agent/shared/protocol'

function page(partial: Partial<PptPageProgress> & Pick<PptPageProgress, 'index' | 'status'>): PptPageProgress {
  return { id: `p${partial.index}`, name: `第${partial.index}页`, issueCount: 0, ...partial }
}

test('slide preview paths stay inside the session', () => {
  expect(slidePreviewPath('/sessions/one', 'data/slides/slide-01.png')).toBe('/sessions/one/data/slides/slide-01.png')
  expect(slidePreviewPath('C:\\sessions\\one', 'data/slides/page-2.webp')).toBe('C:\\sessions\\one\\data\\slides\\page-2.webp')
  expect(slidePreviewPath('/sessions/one', 'data/slides/../../secret.png')).toBeNull()
  expect(slidePreviewPath('/sessions/one', '/etc/passwd')).toBeNull()
})

test('the check summary and row progress follow page state', () => {
  const pages = [
    page({ index: 1, status: 'passed' }),
    page({ index: 2, status: 'needs_revision', issue: '图例离页边仅 6px', issueCount: 1 }),
    page({ index: 3, status: 'needs_revision', failed: true, issue: '超出画布', issueCount: 1 }),
    page({ index: 4, status: 'pending' }),
  ]
  expect(checkSummary(pages)).toEqual({ passed: 1, attention: { index: 3, issue: '超出画布', failed: true } })
  expect(attentionPageNumbers(pages)).toEqual([2, 3])
  expect(attentionCount(pages)).toBe(2)
  expect(formatAttentionPages([5, 9], 'zh-Hans')).toBe('5、9')
  expect(pptRowFraction({ generating: true, total: 15, completed: 5, current: 6 })).toBe(0.4)
  expect(pptRowFraction({ generating: true, total: 15, completed: 5 })).toBe(0)
  expect(pptRowFraction({ generating: false, total: 15, completed: 15, current: 6 })).toBeUndefined()
})

test('a live frame keeps the veil and the completed count on one page', () => {
  expect(pptLiveFrame({ generating: true, total: 11, completed: 11 })).toEqual({ completed: 0 })
  expect(pptLiveFrame({ generating: true, total: 11, completed: 11, current: 1 })).toEqual({ completed: 0, current: 1 })
  expect(pptLiveFrame({ generating: true, total: 11, completed: 11, current: 4 })).toEqual({ completed: 3, current: 4 })
  expect(pptLiveFrame({ generating: false, total: 11, completed: 11, current: 4 })).toEqual({ completed: 11 })
  expect(pptLiveFrame({ generating: true, total: 11, completed: 3, current: 0 })).toEqual({ completed: 0 })
})
