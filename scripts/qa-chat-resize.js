// Start Electron Vite, then: ego-browser nodejs < scripts/qa-chat-resize.js
// Optional globalThis.chatResizeQA = { spaceId, finish: false }.
// Uses production history/reveal code with synthetic messages, not a live session.
const { strict: assert } = await import('node:assert')
const { mkdir, writeFile } = await import('node:fs/promises')
const config = globalThis.chatResizeQA ?? {}
const task = await taskSpace(config.spaceId ?? '聊天缩放回归')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
await page.goto('http://localhost:5173/playground.html')
await page.waitForSelector('#root > *')
await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 400, maxHeight: 300, everyNthFrame: 1 })
await page.evaluate(() => {
  window.__chatResizeQA = null
  void (async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name)
    const React = (await import(resources.find(url => /\/react\.js\?/.test(url)))).default
    const { createRoot } = (await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)))).default
    const { ChatVirtualHistory } = await import('/components/app-shell/ChatVirtualHistory.tsx')
    const workspaceUrl = resources.find(url => url.includes('/apps/electron/node_modules/')).split('/apps/electron/')[0]
    const revealResource = `${workspaceUrl}/packages/ui/src/components/markdown/useSemanticReveal.ts`
    const { useSemanticReveal } = await import(revealResource)
    const h = React.createElement
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const frames = async count => { for (let i = 0; i < count; i++) await frame() }
    const check = (value, message) => { if (!value) throw new Error(message) }
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;color:#222;overflow:auto'
    document.body.append(host)
    // The production viewport exists before history mounts. Attach it first:
    // a parent React ref is still null inside a child's first layout effect.
    const viewport = document.createElement('div')
    viewport.style.cssText = 'width:680px;height:500px;overflow:auto'
    host.append(viewport)
    const root = createRoot(viewport)
    const viewportRef = { current: viewport }
    const historyRef = { current: null }
    let renders = 0, commits = 0, reactMs = 0, setRevision
    const turns = Array.from({ length: 120 }, (_, i) => ({ type: 'user', message: {
      id: `turn-${i}`, content: (`History message ${i} 中文换行测试 `).repeat(100),
    } }))
    const getKey = turn => turn.message.id
    function Fixture() {
      const [, revise] = React.useState(0)
      setRevision = revise
      const [, setRange] = React.useState([0, 0])
      const onWindow = React.useCallback((a, b) => setRange(p => p[0] === a && p[1] === b ? p : [a, b]), [])
      return h(React.Profiler, { id: 'history', onRender: (_, phase, ms) => { commits++; reactMs += ms } },
        h(ChatVirtualHistory, { ref: historyRef, turns, viewportRef, getTurnKey: getKey, onWindowChange: onWindow }, (turn, index) => {
          renders++
          return h('div', { 'data-qa-turn': index }, Array.from({ length: turn.extra ? 24 : 12 }, (_, j) =>
            h('p', { key: j, style: { margin: '8px 0' } }, turn.message.content.slice(0, 180))))
        }))
    }
    const visible = () => [...viewport.querySelectorAll('[data-qa-turn]')].filter(node => {
      const rect = node.getBoundingClientRect(), bounds = viewport.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    const checkRows = () => {
      const rows = visible().map(node => ({ index: Number(node.dataset.qaTurn), rect: node.getBoundingClientRect() }))
        .sort((a, b) => a.index - b.index)
      check(rows.length > 0, 'Visible history is blank')
      for (let i = 1; i < rows.length; i++) check(rows[i].rect.top >= rows[i - 1].rect.bottom - 1, 'History rows overlap')
    }
    try {
      root.render(h(Fixture))
      await frames(90)
      historyRef.current.scrollToTurn(60)
      await frames(90)
      check(visible().some(node => node.dataset.qaTurn === '60'), 'Could not navigate to middle history')
      const anchor = viewport.querySelector('[data-qa-turn="60"]')
      const initialRows = viewport.querySelectorAll('[data-qa-turn]').length
      renders = 0; commits = 0; reactMs = 0
      const intervals = [], widths = []
      let last = performance.now()
      for (let i = 0; i < 120; i++) {
        viewport.style.width = `${680 + 120 * Math.sin(i / 119 * Math.PI * 4)}px`
        const now = await frame()
        intervals.push(now - last); last = now
        widths.push(viewport.clientWidth)
      }
      await frames(30)
      check(Math.max(...widths) - Math.min(...widths) > 200, 'Fixture did not actually resize')
      check(viewport.querySelector('[data-qa-turn="60"]') === anchor, 'Resizing replaced the reading row')
      check(visible().some(node => node.dataset.qaTurn === '60'), 'Resizing lost the reading anchor')
      checkRows()
      const finalRows = viewport.querySelectorAll('[data-qa-turn]').length
      check(finalRows - initialRows < 8, 'Resizing progressively mounted unrelated history')
      const benchmark = { renders, commits, reactMs, initialRows, finalRows,
        p95: intervals.sort((a, b) => a - b)[Math.floor(intervals.length * .95)], over25: intervals.filter(ms => ms > 25).length }
      // Distant navigation must correct the remaining unvisited estimates.
      historyRef.current.scrollToTurn(5)
      await frames(90)
      check(visible().some(node => node.dataset.qaTurn === '5'), 'Distant history navigation failed')
      checkRows()
      const readerOffset = viewport.scrollTop
      turns[119] = { ...turns[119], extra: true }
      setRevision(value => value + 1)
      await frames(30)
      check(Math.abs(viewport.scrollTop - readerOffset) < 2, 'Growth below reader moved the viewport')
      historyRef.current.scrollToLatest()
      await frames(90)
      check(visible().some(node => node.dataset.qaTurn === '119'), 'Latest message is not reachable')
      check(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 2, 'Latest navigation did not settle at bottom')
      checkRows()
      root.unmount()
      const revealHost = document.createElement('div')
      host.append(revealHost)
      const revealRoot = createRoot(revealHost)
      const NativeIntersectionObserver = window.IntersectionObserver
      const nativeAnimate = Element.prototype.animate
      let observers = 0, animations = 0
      window.IntersectionObserver = class extends NativeIntersectionObserver {
        constructor(...args) { super(...args); observers++ }
      }
      Element.prototype.animate = function (...args) {
        if (revealHost.contains(this)) animations++
        return nativeAnimate.apply(this, args)
      }
      function Reveal({ identity, streaming = false, fresh, count = 1 }) {
        const ref = React.useRef(null)
        useSemanticReveal(ref, String(count), fresh, streaming, identity)
        return h('div', { ref }, Array.from({ length: count }, (_, i) => h('p', { key: i }, `段落 ${i}`)))
      }
      try {
        revealRoot.render(h(React.StrictMode, null, h(Reveal, { identity: 'qa-history' })))
        await frames(5)
        check(observers === 0 && animations === 0, 'Historical content initialized reveal observers')
        revealRoot.render(h(React.StrictMode, null, h(Reveal, { identity: 'qa-history', streaming: true })))
        await frames(5)
        check(observers === 1 && animations === 0, 'Resuming history replayed existing text')
        revealRoot.render(h(React.StrictMode, null, h(Reveal, { identity: 'qa-history', streaming: true, count: 2 })))
        await frames(5)
        check(animations === 1, 'New live paragraph did not reveal')
        revealRoot.render(h(Reveal, { identity: 'qa-fresh', fresh: Date.now() }))
        await frames(5)
        check(animations === 2, 'Fresh completed response did not reveal')
        revealRoot.unmount()
        check(revealHost.getAnimations({ subtree: true }).length === 0, 'Reveal animations leaked after unmount')
      } finally {
        window.IntersectionObserver = NativeIntersectionObserver
        Element.prototype.animate = nativeAnimate
      }
      const { ResponseSourcesLayout, useSourcesPanel } = await import(`${workspaceUrl}/packages/ui/src/components/chat/ResponseSourcesLayout.tsx`)
      const sourcesHost = document.createElement('div')
      sourcesHost.style.cssText = 'width:900px;height:500px'
      host.append(sourcesHost)
      const sourcesRoot = createRoot(sourcesHost)
      let sourceCommits = 0
      function SourceTrigger() {
        const open = useSourcesPanel()
        return h('button', { onClick: () => open([{ url: 'https://example.com', hostname: 'example.com', title: 'test' }]) }, 'open')
      }
      try {
        sourcesRoot.render(h(React.Profiler, { id: 'sources', onRender: () => sourceCommits++ },
          h(ResponseSourcesLayout, { messages: [] }, h(SourceTrigger))))
        await frames(5)
        sourceCommits = 0
        for (let i = 0; i < 30; i++) { sourcesHost.style.width = `${900 + i * 3}px`; await frame() }
        check(sourceCommits === 0, 'Closed sources panel subscribed to width changes')
        sourcesHost.querySelector('button').click()
        await frames(45)
        check(!!sourcesHost.querySelector('aside'), 'Sources panel did not open')
        sourcesHost.style.width = '600px'
        await frames(45)
        const width = sourcesHost.querySelector('aside').getBoundingClientRect().width
        check(width >= 219 && width <= 301, 'Opened sources panel did not adapt to width')
      } finally { sourcesRoot.unmount() }
      window.__chatResizeQA = { benchmark, sourcesLifecycle: 'passed', navigation: 'passed', anchorAndGrowth: 'passed', revealLifecycle: 'passed' }
    } finally { host.remove() }
  })().catch(error => { window.__chatResizeQA = { error: String(error), stack: error.stack } })
})
await page.waitForFunction(() => window.__chatResizeQA, undefined, { timeout: 60000 })
const result = await page.evaluate(() => window.__chatResizeQA)
await page.cdp('Page.stopScreencast')
console.log(result)
assert.ok(!result.error, result.stack)
await mkdir('/tmp/selection-chat-resize-qa', { recursive: true })
await writeFile('/tmp/selection-chat-resize-qa/result.json', JSON.stringify(result, null, 2))
if (config.finish !== false) await task.finish({ keep: [] })
