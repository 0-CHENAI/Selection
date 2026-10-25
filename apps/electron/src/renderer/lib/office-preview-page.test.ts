import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { officePreviewPageBridge, pinnedPageAfterScroll, previewDocumentPage, slideNumberFromOfficePath } from './office-preview-page'

test('a pinned office page follows the open file and clears when the person scrolls away', () => {
  const pin = { path: '/deck.pptx', page: 4 }
  expect(slideNumberFromOfficePath('/slide[4]/shape[@name="title"]')).toBe(4)
  expect(pinnedPageAfterScroll(pin, '/slide[4]/shape[@name="title"]')).toEqual(pin)
  expect(pinnedPageAfterScroll(pin, '/slide[5]')).toBeUndefined()
  expect(pinnedPageAfterScroll(pin, undefined)).toEqual(pin)
  expect(previewDocumentPage(pin, '/deck.pptx')).toBe(4)
  expect(previewDocumentPage(pin, '/other.pptx')).toBeUndefined()
})

test('the preview document reveals a slide after restoring scroll', () => {
  const bridge = officePreviewPageBridge(4)
  expect(bridge).toContain('const requestedPage = 4')
  expect(bridge).toContain('selection-office-show-page')
  expect(bridge).toContain('slide-container')
  expect(bridge).toContain('data-slide')
  expect(bridge).toContain('/slide[')
  expect(officePreviewPageBridge(0)).toContain('const requestedPage = null')
  const source = readFileSync(join(import.meta.dir, 'office-preview-document.ts'), 'utf8')
  const reveal = source.indexOf('if (queuedPage) revealPage(queuedPage);')
  const restored = source.indexOf('restored = true;')
  expect(reveal).toBeGreaterThan(0)
  expect(reveal).toBeLessThan(restored)
  expect(source).toContain('officePreviewPageBridge')
})
