import { expect, test } from 'bun:test'
import type { PptProgress } from '@craft-agent/shared/protocol'
import { officeButtonGenerating, officeCollaborationLiveProgress, officeProgressAttribute } from './office-collaboration-progress'

const live: PptProgress = {
  fileName: '项目介绍.pptx',
  pptxPath: '/sessions/one/项目介绍.pptx',
  total: 15,
  completed: 5,
  current: 6,
  currentTitle: '市场机会',
  generating: true,
  pages: [{ index: 6, id: 'p6', name: '备用标题', status: 'fixing', issueCount: 0 }],
}

test('page 6 of 15 fills 40 percent and keeps the page title', () => {
  expect(officeCollaborationLiveProgress(live)).toEqual({ current: 6, total: 15, fraction: 0.4, title: '市场机会' })
  expect(officeProgressAttribute(0.4)).toBe('0.4')
})

test('a missing title falls back to the page name, and an idle deck has no live progress', () => {
  expect(officeCollaborationLiveProgress({ ...live, currentTitle: '  ' })?.title).toBe('备用标题')
  expect(officeCollaborationLiveProgress({ ...live, currentTitle: undefined, pages: [] })?.title).toBeUndefined()
  expect(officeCollaborationLiveProgress({ ...live, generating: false, current: undefined })).toBeNull()
  expect(officeCollaborationLiveProgress({ ...live, current: undefined, completed: 0 })).toBeNull()
  expect(officeCollaborationLiveProgress(undefined)).toBeNull()
})

test('only an in-flight PPT session drives the button', () => {
  expect(officeButtonGenerating({ ppt: {}, isProcessing: true })).toBe(true)
  expect(officeButtonGenerating({ ppt: {}, pptProgress: { generating: true } })).toBe(true)
  expect(officeButtonGenerating({ ppt: {}, isProcessing: false, pptProgress: { generating: false } })).toBe(false)
  expect(officeButtonGenerating({ isProcessing: true, pptProgress: { generating: true } })).toBe(false)
  expect(officeButtonGenerating(null)).toBe(false)
})
