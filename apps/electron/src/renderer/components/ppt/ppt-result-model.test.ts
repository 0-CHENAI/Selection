import { expect, test } from 'bun:test'
import { checkSummary, segmentState, slidePreviewPath, thumbBarClass, thumbDimmed } from './ppt-result-model'
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

test('thumb bars and the check summary follow page state', () => {
  const pages = [
    page({ index: 1, status: 'passed' }),
    page({ index: 2, status: 'needs_revision', issue: '图例离页边仅 6px', issueCount: 1 }),
    page({ index: 3, status: 'needs_revision', failed: true, issue: '超出画布', issueCount: 1 }),
    page({ index: 4, status: 'pending' }),
  ]
  expect(thumbBarClass(pages[0]!, false, undefined)).toBe('bg-success')
  expect(thumbBarClass(pages[1]!, false, undefined)).toBe('bg-info')
  expect(thumbBarClass(pages[2]!, false, undefined)).toBe('bg-destructive')
  expect(thumbBarClass(pages[0]!, true, 2)).toBe('bg-accent')
  expect(thumbBarClass(pages[1]!, true, 2)).toBe('bg-accent/50')
  expect(thumbBarClass(pages[3]!, true, 2)).toBe('bg-foreground/10')
  expect(thumbDimmed(pages[3]!, true, 2)).toBe(true)
  expect(thumbDimmed(pages[1]!, true, 2)).toBe(false)
  expect(checkSummary(pages)).toEqual({ passed: 1, attention: { index: 3, issue: '超出画布', failed: true } })
  expect(segmentState(1, 2)).toBe('done')
  expect(segmentState(2, 2)).toBe('current')
  expect(segmentState(3, 2)).toBe('wait')
})
