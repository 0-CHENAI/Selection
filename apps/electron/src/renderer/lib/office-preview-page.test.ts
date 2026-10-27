import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { officePreviewPageBridge, pinnedPageAfterScroll, previewDocumentPage, requestOfficePreviewReveal, slideNumberFromOfficePath } from './office-preview-page'

test('a pinned office page follows the open file and clears when the person scrolls away', () => {
  const pin = { path: '/deck.pptx', page: 4 }
  expect(slideNumberFromOfficePath('/slide[4]/shape[@name="title"]')).toBe(4)
  expect(pinnedPageAfterScroll(pin, '/slide[4]/shape[@name="title"]')).toEqual(pin)
  expect(pinnedPageAfterScroll(pin, '/slide[5]')).toBeUndefined()
  expect(pinnedPageAfterScroll(pin, undefined)).toEqual(pin)
  expect(previewDocumentPage(pin, '/deck.pptx')).toBe(4)
  expect(previewDocumentPage(pin, '/other.pptx')).toBeUndefined()
})

test('a row click opens a slide, or asks the panel to wait when the file is not ready', () => {
  const events: Event[] = []
  const previous = globalThis.window
  globalThis.window = { dispatchEvent(event: Event) { events.push(event); return true } } as Window & typeof globalThis
  try {
    requestOfficePreviewReveal({ sessionId: 's1', path: '/deck.pptx', page: 6 })
    requestOfficePreviewReveal({ sessionId: 's1' })
    requestOfficePreviewReveal({ sessionId: '' })
  } finally {
    if (previous === undefined) delete (globalThis as { window?: Window }).window
    else globalThis.window = previous
  }
  expect(events.map(event => event.type)).toEqual(['selection-office-show-page', 'selection-office-reveal'])
  expect((events[0] as CustomEvent).detail).toEqual({ sessionId: 's1', path: '/deck.pptx', page: 6 })
  expect((events[1] as CustomEvent).detail).toEqual({ sessionId: 's1' })
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
  const fit = source.indexOf('fitSlidesToViewport();')
  const scroll = source.indexOf('window.scrollTo(')
  expect(reveal).toBeGreaterThan(0)
  expect(fit).toBeGreaterThan(0)
  expect(fit).toBeLessThan(scroll)
  expect(scroll).toBeLessThan(reveal)
  expect(reveal).toBeLessThan(restored)
  expect(source).toContain('window.scaleSlides')
  expect(source).toContain('Math.abs(next - fittedWidth) < 1')
  expect(source).toContain("window.addEventListener('load'")
  const loadFit = source.indexOf("window.addEventListener('load'")
  expect(loadFit).toBeGreaterThan(restored)
  expect(source).toContain('officePreviewPageBridge')
})
