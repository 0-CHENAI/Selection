// Start the Electron Vite server, then: ego-browser nodejs < scripts/qa-window-resize.js
// Optional globalThis.windowResizeQA = { spaceId, url, finish: false } to reuse a QA space.
// Uses production components with a synthetic 100-section document, not live Office RPC.
const { strict: assert } = await import('node:assert')
const { mkdir, writeFile } = await import('node:fs/promises')
const config = globalThis.windowResizeQA ?? {}
const task = await taskSpace(config.spaceId ?? '窗口缩放性能回归')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
await page.goto(config.url ?? 'http://localhost:5173/playground.html')
await page.waitForSelector('#root > *')
// Offscreen browser surfaces otherwise throttle animation frames. Keep this
// identical for before/after runs; timings are diagnostic, not CI thresholds.
await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 400, maxHeight: 300, everyNthFrame: 1 })
await page.evaluate(() => {
  window.__windowResizeQA = null
  void (async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name)
    const React = (await import(resources.find(url => /\/react\.js\?/.test(url)))).default
    const { createRoot } = (await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)))).default
    const { OfficePreviewPanel } = await import('/components/app-shell/OfficePreviewPanel.tsx')
    const { OfficePreviewFrame } = await import('/components/app-shell/OfficePreviewFrame.tsx')
    const { useContainerBreakpoint } = await import('/hooks/useContainerBreakpoint.ts')
    const h = React.createElement
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;color:#222;overflow:auto'
    document.body.append(host)
    const root = createRoot(host)
    const originalAPI = window.electronAPI
    const nativeListeners = new Set()
    let nativeResizing = false
    window.electronAPI = { ...originalAPI, onWindowResizeStateChange: callback => {
      nativeListeners.add(callback)
      callback(nativeResizing)
      return () => nativeListeners.delete(callback)
    } }
    const nativeResize = value => {
      nativeResizing = value
      for (const callback of nativeListeners) callback(value)
    }
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const settle = async predicate => {
      for (let i = 0; i < 120; i++) { await frame(); if (predicate()) return }
      throw new Error('Layout did not settle')
    }
    const check = (value, message) => { if (!value) throw new Error(message) }
    let shellCommits = 0, officeCommits = 0, reactMs = 0, loads = 0, presence = false
    const onPresenceChange = value => { presence = value }
    const html = '<style>body{font:16px system-ui;margin:24px}section{padding:24px;border-bottom:1px solid #ddd}p{line-height:1.5}</style>'
      + Array.from({ length: 100 }, (_, i) => `<section><h2>Office 文档第 ${i + 1} 页</h2>${'<p>用于重复验证窗口宽度变化中的文档排版、长文本换行与预览尺寸同步。</p>'.repeat(12)}</section>`).join('')
    const content = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      h(OfficePreviewFrame, { title: 'resize fixture', srcDoc: html, onLoad: () => loads++ }))
    function Shell() {
      const ref = React.useRef(null)
      const compact = useContainerBreakpoint(ref, 768)
      return h('div', { ref, 'data-qa-shell': '', 'data-compact': String(compact), style: { flex: 1, minWidth: 0, overflow: 'auto' } },
        Array.from({ length: 100 }, (_, i) => h('article', { key: i }, h('h3', null, `消息 ${i + 1}`), h('p', null, '窗口变化不应重新执行聊天和导航的 React 渲染。'.repeat(10)))))
    }
    function Fixture({ open }) {
      return h('div', { 'data-qa-layout': '', style: { display: 'flex', width: 1400, height: 720, containerType: 'inline-size' } },
        h(React.Profiler, { id: 'shell', onRender: (_, phase, duration) => { shellCommits++; reactMs += duration } }, h(Shell)),
        h(React.Profiler, { id: 'office', onRender: (_, phase, duration) => { officeCommits++; reactMs += duration } },
          h(OfficePreviewPanel, { open, onPresenceChange }, content)))
    }
    try {
      root.render(h(Fixture, { open: true }))
      await settle(() => loads === 1 && host.querySelector('[data-office-panel]')?.style.getPropertyValue('--office-panel-open') === '1')
      const layout = host.querySelector('[data-qa-layout]')
      const panel = host.querySelector('[data-office-panel]')
      const iframe = host.querySelector('iframe')
      const frameWindow = iframe.contentWindow
      let documentResizes = 0
      frameWindow.addEventListener('resize', () => documentResizes++)
      const targetWidth = width => Math.min(width / 2, Math.max(320, width * 0.45))
      // Warm up the same workload before measuring.
      for (let i = 0; i < 60; i++) await frame()
      shellCommits = 0; officeCommits = 0; reactMs = 0
      documentResizes = 0
      const initialDocumentWidth = iframe.clientWidth
      let last = performance.now()
      const deltas = [], errors = []
      for (let i = 0; i < 240; i++) {
        const width = 1600 + 200 * Math.cos(i / 239 * Math.PI * 4)
        layout.style.width = `${width}px`
        const now = await frame()
        deltas.push(now - last); last = now
        errors.push(Math.abs(panel.getBoundingClientRect().width - targetWidth(width)))
        check(iframe.clientWidth === initialDocumentWidth, 'Document reflowed during continuous resizing')
      }
      const documentResizesDuringDrag = documentResizes
      const commits = { shellCommits, officeCommits, reactMs }
      for (let i = 0; i < 60; i++) await frame()
      const tailCommits = { shell: shellCommits - commits.shellCommits, office: officeCommits - commits.officeCommits }
      const sorted = deltas.slice(1).sort((a, b) => a - b)
      const benchmark = { ...commits, tailCommits, documentResizesDuringDrag, documentResizesAfterSettle: documentResizes, frames: sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)],
        over25ms: sorted.filter(value => value > 25).length,
        meanWidthError: errors.reduce((sum, value) => sum + value, 0) / errors.length, maxWidthError: Math.max(...errors) }
      check(officeCommits === 0, 'Office must not commit React renders during window resizing')
      // Scrollbar width can cause two breakpoint crossings per sweep.
      check(shellCommits <= 8, 'Shell must only render at breakpoint crossings')
      check(Math.max(...errors) < 0.1, 'Office must follow the container without spring lag')
      check(tailCommits.shell === 0 && tailCommits.office === 0, 'Resize must not leave a spring running')
      check(documentResizesDuringDrag === 0 && documentResizes === 1, 'Document must resize once after dragging stops')
      check(!host.querySelector('[data-office-resizing]') && !iframe.style.visibility, 'Document was not revealed after resizing')
      check(Math.abs(iframe.clientWidth - host.querySelector('[data-office-preview-viewport]').clientWidth) <= 1, 'Document did not settle to the final width')
      const placeholder = host.querySelector('[data-office-resize-placeholder]')
      check(getComputedStyle(placeholder).display === 'none', 'Resize placeholder must be hidden when idle')
      // Native resize events should pause the document even within the range
      // where the Office panel stays at its minimum width.
      window.dispatchEvent(new Event('resize'))
      check(getComputedStyle(placeholder).display === 'flex' && getComputedStyle(iframe).visibility === 'hidden', 'Native resize did not replace the document with its placeholder')
      check(placeholder.textContent.trim().length > 0 && !placeholder.textContent.includes('chat.officePreview'), 'Placeholder translation is missing')
      await settle(() => !host.querySelector('[data-office-resizing]'))
      check(getComputedStyle(placeholder).display === 'none' && getComputedStyle(iframe).visibility === 'visible', 'Native resize did not resume the document')
      // Holding the native edge without moving must outlast the 160ms fallback.
      documentResizes = 0
      nativeResize(true)
      layout.style.width = '1500px'
      window.dispatchEvent(new Event('resize'))
      for (let i = 0; i < 40; i++) {
        await frame()
        check(getComputedStyle(placeholder).display === 'flex' && iframe.style.visibility === 'hidden', 'Holding restored the document before pointer release')
        check(documentResizes === 0, 'Holding resized the document')
      }
      // Mounting another cached preview mid-gesture must also stay paused.
      const lateHost = document.createElement('div')
      lateHost.style.cssText = 'display:flex;width:500px;height:300px'
      host.append(lateHost)
      const lateRoot = createRoot(lateHost)
      lateRoot.render(h(OfficePreviewFrame, { srcDoc: '<p>Late preview</p>' }))
      await settle(() => lateHost.querySelector('[data-office-resizing]'))
      const lateFrame = lateHost.querySelector('iframe')
      const lateWidth = lateFrame.clientWidth
      lateHost.style.width = '600px'
      for (let i = 0; i < 15; i++) await frame()
      check(lateHost.querySelector('[data-office-resizing]'), 'Preview mounted during holding resumed early')
      check(lateFrame.clientWidth === lateWidth, 'Preview mounted during holding did not freeze its viewport')
      nativeResize(false)
      await settle(() => !host.querySelector('[data-office-resizing]'))
      await settle(() => documentResizes > 0)
      check(documentResizes === 1, 'Release must apply final document dimensions once')
      check(host.querySelector('iframe') === iframe && loads === 1, 'Holding reloaded the document')
      lateRoot.unmount(); lateHost.remove()
      const widths = []
      for (const width of [400, 640, 700, 768, 900, 1400, 2000]) {
        layout.style.width = `${width}px`
        await frame(); await frame()
        const actual = panel.getBoundingClientRect().width
        check(Math.abs(actual - targetWidth(width)) < 0.1, `Incorrect split at ${width}px`)
        widths.push({ width, panel: actual })
      }
      // Height-only resizing and widths within one desktop band must be silent.
      shellCommits = 0; officeCommits = 0
      for (let i = 0; i < 30; i++) {
        layout.style.width = `${1800 + i}px`; layout.style.height = `${700 + i}px`
        await frame()
      }
      check(shellCommits === 0 && officeCommits === 0, 'Same-band or height changes caused React renders')
      check(host.querySelector('iframe') === iframe && iframe.contentWindow === frameWindow && loads === 1, 'Resize reloaded the document')
      await settle(() => !host.querySelector('[data-office-resizing]'))
      frameWindow.scrollTo(0, 500)
      const documentWidth = iframe.getBoundingClientRect().width
      root.render(h(Fixture, { open: false }))
      await settle(() => panel.dataset.officePanel === 'closing')
      check(host.querySelector('iframe') === iframe && presence, 'Closing must retain the outgoing document')
      check(Math.abs(iframe.getBoundingClientRect().width - documentWidth) < 0.1, 'Closing must not squeeze the document')
      root.render(h(Fixture, { open: true }))
      await settle(() => panel.style.getPropertyValue('--office-panel-open') === '1')
      check(host.querySelector('iframe') === iframe && loads === 1 && frameWindow.scrollY === 500, 'Reopening lost document identity or scroll position')
      root.render(h(Fixture, { open: false }))
      await settle(() => panel.dataset.officePanel === 'closed')
      check(!presence && panel.getBoundingClientRect().width === 0, 'Close did not release the layout slot')
      // Suspending a cached session cancels pending viewport work. Showing it
      // again must recover its real size without reloading or losing selection.
      root.render(h(Fixture, { open: true }))
      await settle(() => panel.style.getPropertyValue('--office-panel-open') === '1')
      layout.style.width = '1700px'
      nativeResize(true)
      await settle(() => host.querySelector('[data-office-resizing]'))
      layout.style.display = 'none'
      await settle(() => !host.querySelector('[data-office-resizing]'))
      const hiddenDocumentWidth = iframe.style.width
      for (let i = 0; i < 15; i++) await frame()
      check(iframe.style.width === hiddenDocumentWidth, 'Hidden document had a delayed resize')
      layout.style.display = 'flex'
      await settle(() => host.querySelector('[data-office-resizing]'))
      for (let i = 0; i < 15; i++) await frame()
      check(iframe.style.visibility === 'hidden', 'Cached preview resumed while still holding')
      nativeResize(false)
      await settle(() => !host.querySelector('[data-office-resizing]') && Math.abs(iframe.clientWidth - host.querySelector('[data-office-preview-viewport]').clientWidth) <= 1)
      check(loads === 1, 'Resuming the cached document reloaded its iframe')
      // Exact boundary semantics, including hidden containers, without scrollbars.
      let probeCommits = 0
      function Probe({ threshold }) {
        const ref = React.useRef(null)
        const below = useContainerBreakpoint(ref, threshold)
        probeCommits++
        return h('div', { ref, 'data-probe': String(below), style: { width: 800, height: 20 } })
      }
      root.render(h(Probe, { threshold: 768 }))
      await settle(() => host.querySelector('[data-probe]'))
      check(nativeListeners.size === 0, 'Unmount leaked native resize subscriptions')
      const probe = host.querySelector('[data-probe]')
      const breakpoints = []
      for (const width of [800, 799, 768, 767.5, 700, 0, 767, 768, 900]) {
        probe.style.width = `${width}px`
        await frame(); await frame()
        check(probe.dataset.probe === String(width > 0 && width < 768), `Incorrect breakpoint at ${width}px`)
        breakpoints.push({ width, below: probe.dataset.probe, commits: probeCommits })
      }
      root.render(h(Probe, { threshold: 1000 }))
      await settle(() => probe.dataset.probe === 'true')
      window.__windowResizeQA = { benchmark, widths, breakpoints, lifecycle: 'passed', nativeHolding: 'passed', iframeLoads: loads }
    } finally {
      root.unmount(); host.remove()
      window.electronAPI = originalAPI
    }
  })().catch(error => { window.__windowResizeQA = { error: String(error) } })
})
await page.waitForFunction(() => window.__windowResizeQA, undefined, { timeout: 60000 })
const result = await page.evaluate(() => window.__windowResizeQA)
await page.cdp('Page.stopScreencast')
assert.ok(!result.error, result.error)
await mkdir('/tmp/selection-window-resize-qa', { recursive: true })
await writeFile('/tmp/selection-window-resize-qa/result.json', JSON.stringify(result, null, 2))
console.log(result)
if (config.finish !== false) await task.finish({ keep: [] })
