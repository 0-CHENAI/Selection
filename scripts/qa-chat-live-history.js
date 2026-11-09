// Start Electron Vite, then: ego-browser nodejs < scripts/qa-chat-live-history.js
// Exercises the production virtual list without sending messages to a model.
const config = globalThis.chatLiveHistoryQA ?? {}
const task = await taskSpace(config.spaceId ?? '会话实时渲染回归')
const page = task.page('p1')
await page.goto('http://localhost:5173/playground.html')
await page.waitForSelector('#root > *')
await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 400, maxHeight: 300, everyNthFrame: 1 })
await page.evaluate(() => {
  window.__liveHistoryQA = null
  void (async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name)
    const React = (await import(resources.find(url => /\/react\.js\?/.test(url)))).default
    const { createRoot } = (await import(resources.find(url => /\/react-dom_client\.js\?/.test(url)))).default
    const { ChatVirtualHistory } = await import('/components/app-shell/ChatVirtualHistory.tsx')
    const { createStickyScrollFollow } = await import('/components/app-shell/ChatDisplay.scroll-to-bottom.ts')
    const h = React.createElement
    const frames = async n => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame) }
    const check = (value, message) => { if (!value) throw new Error(message) }
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white'
    document.body.append(host)
    const viewport = document.createElement('div')
    viewport.style.cssText = 'width:680px;height:400px;overflow:auto;overflow-anchor:none'
    host.append(viewport)
    const root = createRoot(viewport)
    const viewportRef = { current: viewport }, historyRef = { current: null }
    const history = Array.from({ length: 80 }, (_, i) => ({ type: 'user', message: { id: `u${i}`, content: '历史消息' } }))
    let update
    function Fixture() {
      const [state, setState] = React.useState({ turns: history, active: undefined, height: 0 })
      update = setState
      return h(ChatVirtualHistory, {
        ref: historyRef, turns: state.turns, viewportRef,
        activeTurnStartIndex: state.active,
        getTurnKey: turn => turn.type === 'assistant' ? turn.turnId : turn.message.id,
        onWindowChange: () => {},
      }, turn => h('div', {
        'data-qa-key': turn.type === 'assistant' ? turn.turnId : turn.message.id,
        style: { height: turn.type === 'assistant' ? state.height : 100 },
      }, turn.type === 'assistant' ? '正在处理工具调用' : turn.message.content))
    }
    try {
      root.render(h(Fixture)); await frames(30)
      historyRef.current.scrollToTurn(20); await frames(30)
      const before = viewport.scrollTop
      const turns = [...history,
        { type: 'user', message: { id: 'sent', content: '请生成报告' } },
        { type: 'assistant', turnId: 'live', activities: [], isStreaming: true },
      ]
      // Reproduce the old contract: data exists, but its row is absent while
      // the virtual window still points at the previous reading position.
      update({ turns, active: undefined, height: 0 }); await frames(10)
      check(!viewport.querySelector('[data-qa-key="live"]'), 'Control did not reproduce the unmounted live row')
      update({ turns, active: 80, height: 0 }); await frames(10)
      const live = viewport.querySelector('[data-qa-key="live"]')
      check(live, 'Current assistant was not mounted outside the estimated window')
      check(live.parentElement.style.contentVisibility !== 'auto', 'Active request still uses an estimated content box')
      check(Math.abs(viewport.scrollTop - before) < 2, 'Mounting live work moved the history reader')
      update({ turns, active: 80, height: 260 }); await frames(15)
      check(live === viewport.querySelector('[data-qa-key="live"]'), 'Tool update remounted the assistant')
      check(live.parentElement.getBoundingClientRect().height === 260, 'Live growth was not measured')
      const sent = viewport.querySelector('[data-qa-key="sent"]')
      check(live.getBoundingClientRect().top >= sent.getBoundingClientRect().bottom - 1, 'Pinned rows overlap')
      historyRef.current.scrollToLatest(); await frames(30)
      check(live.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom + 2, 'Latest work cannot be revealed without a session switch')
      // Use the production follow loop and ResizeObserver wiring, not a test
      // scrollToBottom on each token. The reader must be able to interrupt it.
      let sticky = true
      const follow = createStickyScrollFollow(viewport, { sticky: () => sticky, reduceMotion: () => false })
      const observer = new ResizeObserver(() => {
        if (sticky) historyRef.current.cancelScroll()
        follow.resize()
      })
      observer.observe(viewport.firstElementChild)
      try {
        for (let i = 1; i <= 40; i++) {
          update({ turns, active: 80, height: 260 + i * 12 })
          await frames(2)
        }
        await frames(45)
        check(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 2, 'Streaming growth lost bottom follow')
        sticky = false
        viewport.scrollTop -= 300
        const readerTop = viewport.scrollTop
        for (let i = 1; i <= 20; i++) {
          update({ turns, active: 80, height: 740 + i * 12 })
          await frames(2)
        }
        await frames(15)
        check(Math.abs(viewport.scrollTop - readerTop) < 2, 'Streaming pulled the reader back down')
        sticky = true
        follow.resize()
        await frames(60)
        check(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 2, 'Returning to bottom did not resume follow')
      } finally { observer.disconnect(); follow.dispose() }
      const mounted = viewport.querySelectorAll('[data-qa-key]').length
      check(mounted < 30, 'Pinning current work mounted the entire history')
      update({ turns: turns.map(t => t.type === 'assistant' ? { ...t, isStreaming: false } : t), active: undefined, height: 980 }); await frames(15)
      check(live === viewport.querySelector('[data-qa-key="live"]'), 'Completion replaced the assistant row')
      window.__liveHistoryQA = { ok: true, mounted, checks: ['old-contract reproduction', 'zero-height live mount', 'tool-only growth', 'reader anchor', 'row positioning', 'reveal without remount', 'bounded history', 'completion identity', 'continuous streaming follow', 'reader interrupts follow', 'resume follow'] }
    } catch (error) {
      window.__liveHistoryQA = { ok: false, error: String(error), stack: error.stack }
    } finally { root.unmount(); host.remove() }
  })()
})
await page.waitForFunction(() => window.__liveHistoryQA !== null, undefined, { timeout: 30000 })
const result = await page.evaluate(() => window.__liveHistoryQA)
console.log(JSON.stringify(result))
await page.cdp('Page.stopScreencast')
if (!result.ok) throw new Error(result.error)
if (config.finish !== false) await task.finish({ keep: [] })
