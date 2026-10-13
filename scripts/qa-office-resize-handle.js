// ego-browser nodejs < scripts/qa-office-resize-handle.js
// Optional globalThis.officeResizeQA = { spaceId, finish: false }.
const { strict: assert } = await import('node:assert')
const config = globalThis.officeResizeQA ?? {}
const task = await taskSpace(config.spaceId ?? 'Office 宽度拖动回归')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
await page.goto('http://localhost:5173/playground.html')
await page.waitForSelector('#root > *')
await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 400, maxHeight: 300, everyNthFrame: 1 })
await page.evaluate(async () => {
  const resources = performance.getEntriesByType('resource').map(entry => entry.name)
  const React = (await import(resources.find(url => /\/react\.js\?/.test(url)))).default
  const { createRoot } = (await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)))).default
  const { OfficePreviewPanel } = await import('/components/app-shell/OfficePreviewPanel.tsx')
  const { OfficePreviewFrame } = await import('/components/app-shell/OfficePreviewFrame.tsx')
  const h = React.createElement
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;overflow:auto'
  document.body.append(host)
  const root = createRoot(host)
  window.__sashQA = { loads: 0, resizes: 0 }
  const content = h('div', { style: { display: 'flex', height: '100%' } }, h(OfficePreviewFrame, {
    srcDoc: '<p>Office preview</p>'.repeat(300),
    onLoad: () => {
      window.__sashQA.loads++
      host.querySelector('iframe').contentWindow.addEventListener('resize', () => window.__sashQA.resizes++)
    },
  }))
  const presence = () => {}
  function Fixture({ open }) {
    return h('div', { 'data-sash-layout': '', style: { display: 'flex', width: 1200, height: 600, containerType: 'inline-size' } },
      h('div', { style: { flex: 1, minWidth: 0 } }, '聊天区'), h(OfficePreviewPanel, { open, onPresenceChange: presence }, content))
  }
  window.__sashQA.render = open => root.render(h(Fixture, { open }))
  window.__sashQA.cleanup = () => { root.unmount(); host.remove() }
  window.__sashQA.render(true)
})
await page.waitForFunction(() => window.__sashQA.loads === 1 && !document.querySelector('[data-office-resizing]') && document.querySelector('[data-office-panel]')?.style.getPropertyValue('--office-panel-open') === '1')
const state = () => page.evaluate(() => {
  const panel = document.querySelector('[data-office-panel]')
  const handle = document.querySelector('[data-office-resize-handle]')
  const iframe = panel.querySelector('iframe')
  return { width: panel.getBoundingClientRect().width, x: panel.getBoundingClientRect().left + 3, y: 200,
    holding: panel.dataset.officePanelResizing === 'true', paused: !!panel.querySelector('[data-office-resizing]'),
    hidden: iframe.style.visibility === 'hidden', documentWidth: iframe.clientWidth, loads: window.__sashQA.loads,
    resizes: window.__sashQA.resizes, scroll: iframe.contentWindow.scrollY,
    label: handle?.getAttribute('aria-label'), selected: getSelection().toString(), cursor: document.body.style.cursor }
})
await page.evaluate(() => {
  window.__sashQA.resizes = 0
  document.querySelector('[data-office-panel] iframe').contentWindow.scrollTo(0, 500)
})
const before = await state()
assert.equal(before.width, 540)
assert.ok(before.label && !before.label.includes('chat.officePreview'))
await page.mouse.move(before.x, before.y)
await page.mouse.down()
await page.waitForFunction(() => document.querySelector('[data-office-panel-resizing]'))
await page.mouse.move(before.x - 200, before.y)
await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)))
const holding = await state()
assert.equal(holding.width, 740)
assert.ok(holding.holding && holding.paused && holding.hidden)
assert.equal(holding.documentWidth, before.documentWidth)
assert.equal(holding.resizes, 0)
await page.mouse.up()
await page.waitForFunction(() => !document.querySelector('[data-office-resizing]') && window.__sashQA.resizes === 1)
const released = await state()
assert.ok(!released.holding && !released.hidden)
assert.equal(released.scroll, 500)
assert.equal(released.loads, 1)
assert.equal(released.cursor, before.cursor)
assert.equal(await page.evaluate(() => document.querySelector('[data-office-resize-handle]').matches(':focus-visible')), false)
// Keyboard limits and reset; the focused separator controls the right panel.
// The separator itself is zero-width; its child supplies the pointer hit area.
await page.evaluate(() => document.querySelector('[data-office-resize-handle]').focus())
await page.keyboard.press('ArrowRight')
assert.equal((await state()).width, 708)
await page.keyboard.press('End')
assert.equal((await state()).width, 760)
await page.keyboard.press('Home')
assert.equal((await state()).width, 320)
await page.keyboard.press('Enter')
assert.equal((await state()).width, 540)
// Width persists while the panel is closed and follows the window proportion.
await page.keyboard.press('ArrowLeft')
const custom = await state()
await page.evaluate(() => window.__sashQA.render(false))
await page.waitForFunction(() => document.querySelector('[data-office-panel="closed"]'))
await page.evaluate(() => window.__sashQA.render(true))
await page.waitForFunction(() => document.querySelector('[data-office-panel]')?.style.getPropertyValue('--office-panel-open') === '1')
assert.equal((await state()).width, custom.width)
// Cancelled capture / closing while held must restore interaction and preview.
const next = await state()
await page.mouse.move(next.x, next.y)
await page.mouse.down()
await page.waitForFunction(() => document.querySelector('[data-office-panel-resizing]'))
await page.evaluate(() => window.dispatchEvent(new Event('blur')))
await page.mouse.up()
await page.waitForFunction(() => !document.querySelector('[data-office-resizing]'))
assert.ok(!(await state()).holding)
await page.evaluate(() => document.querySelector('[data-office-resize-handle]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
assert.equal((await state()).width, 540)
await page.evaluate(() => { document.querySelector('[data-sash-layout]').style.width = '400px' })
await page.waitForFunction(() => Math.abs(document.querySelector('[data-office-panel]').getBoundingClientRect().width - 200) < 0.1)
await page.evaluate(() => window.__sashQA.cleanup())
assert.equal(await page.evaluate(() => document.body.style.cursor), before.cursor)
await page.cdp('Page.stopScreencast')
console.log({ drag: 'passed', holding: 'passed', release: 'passed', keyboardAndLimits: 'passed', lifecycle: 'passed' })
if (config.finish !== false) await task.finish({ keep: [] })
