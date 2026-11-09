// Production ResponseCard + Markdown + sticky-follow browser regression.
// Start Electron Vite, then: ego-browser nodejs < scripts/qa-streaming-stability.js
// Optional globalThis.streamingStabilityQA = { spaceId, finish: false }.
const config = globalThis.streamingStabilityQA ?? {}
const task = await taskSpace(config.spaceId ?? '流式渲染稳定性回归')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
await page.goto('http://localhost:5173/playground.html')
await page.waitForSelector('#root > *')
await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 400, maxHeight: 300, everyNthFrame: 1 })
await page.evaluate(() => {
  window.__streamingStability = null
  void (async () => {
    const urls = performance.getEntriesByType('resource').map(e => e.name)
    const reactUrl = urls.find(u => /\/react\.js\?/.test(u))
    const React = (await import(reactUrl)).default
    const { flushSync } = (await import(reactUrl.replace('/react.js?', '/react-dom.js?'))).default
    const { createRoot } = (await import(urls.find(u => /\/react-dom_client\.js\?/.test(u)))).default
    const base = urls.find(u => u.includes('/apps/electron/node_modules/')).split('/apps/electron/')[0]
    const { ResponseCard } = await import(`${base}/packages/ui/src/components/chat/TurnCard.tsx`)
    const { createSemanticReveal } = await import(`${base}/packages/ui/src/components/markdown/semantic-reveal.ts`)
    const { createStickyScrollFollow } = await import(`${base}/apps/electron/src/renderer/components/app-shell/ChatDisplay.scroll-to-bottom.ts`)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--background);padding:24px'
    const viewport = document.createElement('div')
    viewport.style.cssText = 'height:400px;width:700px;overflow:auto;overflow-anchor:none'
    const mount = document.createElement('div')
    viewport.append(mount); host.append(viewport); document.body.append(host)
    const root = createRoot(mount)
    const noop = () => {}
    const render = (text, id, streaming = true) => flushSync(() => root.render(React.createElement(ResponseCard, {
      text, isStreaming: streaming, isTurnComplete: !streaming, sessionId: 'stability-qa',
      messageId: id, revealIdentity: id, onRegenerate: noop, onPopOut: noop,
    })))
    const check = (value, message) => { if (!value) throw Error(message) }
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const painted = async () => { await frame(); await frame() }
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const body = () => mount.querySelector('.markdown-content')
    const animations = () => body().getAnimations({ subtree: true })
    const animTexts = () => animations().map(a => a.effect.target.textContent)
    let sticky = true
    const follow = createStickyScrollFollow(viewport, { sticky: () => sticky, reduceMotion: () => false })
    const resize = new ResizeObserver(() => follow.resize())
    const results = {}
    try {
      render('结论：**你的系统当前是通的', 'bold')
      await sleep(240)
      render('结论：**你的系统当前是通的**，下一步', 'bold')
      await painted()
      check(body().querySelector('strong')?.textContent === '你的系统当前是通的', 'Bold did not resolve')
      check(!animTexts().includes('你的系统当前是通的'), 'Already visible bold text replayed')
      check(animTexts().includes('，下一步'), 'New tail did not fade')
      results.bold = animTexts()

      render('查看[官网', 'link'); await sleep(240)
      render('查看[官网](https://example.com)，新文字', 'link'); await painted()
      check(body().querySelector('a[href="https://example.com"]'), 'Link did not resolve')
      check(!animTexts().includes('官网'), 'Already visible link label replayed')
      results.link = animTexts()

      render('| 项目 | 状态 |\n', 'table'); await sleep(240)
      render('| 项目 | 状态 |\n| --- | --- |\n| 网络 | 正常 |', 'table'); await painted()
      check(body().querySelector('table'), 'Table did not resolve')
      check(!animTexts().some(text => text === '项目' || text === '状态'), 'Table headers replayed')
      results.table = animTexts()

      render('原文', 'burst'); await sleep(240)
      for (let i = 0; i < 20; i++) render('原文' + '字'.repeat(i + 1), 'burst')
      check(body().textContent === '原文', 'Appends rendered before the shared paint boundary')
      await painted()
      check(body().textContent === '原文' + '字'.repeat(20), 'Paint lost a delta')
      check(body().querySelectorAll('[data-stream-chunk]').length === 2, 'Burst created per-event runs')
      check(animations().length === 1, 'Burst did not coalesce into one fade')
      check(animations().every(a => a.effect.getTiming().duration === 180 && a.effect.getTiming().delay === 0), 'Unexpected timing')
      check(animations().every(a => a.effect.getKeyframes().every(k => !('filter' in k) && !('transform' in k))), 'Default animation changes geometry or adds filter layers')
      results.burst = { receivedEvents: 20, chunks: 2, activeFades: 1, duration: 180 }
      const prefixNode = body().querySelector('[data-stream-chunk]')
      render('原文' + '字'.repeat(21), 'burst')
      render('原文' + '字'.repeat(22), 'burst', false)
      check(body().textContent === '原文' + '字'.repeat(22), 'Completion did not synchronously flush')
      check(body().querySelector('[data-stream-chunk]') === prefixNode, 'Completion remounted the stable prefix')
      await painted()
      check(body().textContent === '原文' + '字'.repeat(22), 'Stale pending frame overwrote completion')
      results.completion = 'flush and identity preserved'

      render('旧消息', 'history', false)
      check(animations().length === 0, 'History played a fade')
      render('新消息', 'new-identity')
      check(body().textContent === '新消息', 'New identity briefly showed stale content')
      render('待提交文本', 'new-identity'); render('替换内容', 'new-identity')
      check(body().textContent === '替换内容', 'Edit did not flush immediately')
      await painted(); check(body().textContent === '替换内容', 'An old frame overwrote the edit')
      results.identityAndEdits = 'passed'

      const references = '第一段 [引用][source] 与脚注[^note]。\n\n第二段。\n\n[source]: https://example.com\n\n[^note]: 注释'
      render(references.slice(0, references.indexOf('[source]:')), 'references'); await sleep(240)
      render(references, 'references'); await painted()
      check(body().querySelector('a[href="https://example.com"]'), 'Late reference failed')
      check(!animTexts().includes('引用'), 'Late definition replayed an old link')
      check(body().textContent.includes('注释'), 'Footnote content is missing')
      results.references = 'passed'

      // rehype-raw merges the punctuation and newline in a nested list into
      // a generated text node with a start position but no end position.
      render('1. **父项**：\n   - 子项\n\n尾部', 'nested-history', false)
      check(body().textContent.includes('父项：\n'), 'Nested list lost its punctuation')
      check(body().textContent.includes('子项'), 'Historical nested list failed to render')
      results.partialSourcePositions = 'passed'

      const probeViewport = document.createElement('div')
      probeViewport.style.cssText = 'position:fixed;top:0;left:0;height:100px;width:300px;overflow:auto'
      const probeRoot = document.createElement('div')
      probeRoot.style.paddingTop = '300px'
      const probeText = document.createElement('span')
      probeText.setAttribute('data-stream-chunk', '')
      probeText.textContent = 'original'
      probeRoot.append(probeText); probeViewport.append(probeRoot); host.append(probeViewport)
      const probeReveal = createSemanticReveal(probeRoot, true)
      try {
        probeReveal.update(true, true, 'original')
        check(probeText.style.clipPath.includes('100%'), 'Offscreen probe was not pending')
        probeText.textContent = 'replacement'
        probeReveal.update(true, true, 'replacement')
        check(probeText.style.clipPath === '', 'Edited offscreen text stayed hidden')
        results.offscreenEdit = 'exposed immediately'
      } finally { probeReveal.dispose(); probeViewport.remove() }

      render('说明\n\n```mermaid\ngraph TD\nA-->B', 'rich')
      check(mount.querySelector('[data-streaming-block-placeholder="mermaid"]'), 'Open rich fence lacks a placeholder')
      render('说明\n\n```mermaid\ngraph TD\nA-->B\n```', 'rich', false)
      check(!mount.querySelector('[data-streaming-block-placeholder]'), 'Completion left a rich placeholder')
      results.richFence = 'passed'

      let text = '稳定前文。\n\n'.repeat(35) + '尾部'
      render(text, 'scroll'); await painted(); await sleep(240)
      viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight
      resize.observe(mount); resize.observe(viewport)
      const oldTop = viewport.scrollTop
      text += '\n\n新增一段文本。'
      render(text, 'scroll')
      const positions = []
      // Frame counts alone are not a time budget on high-refresh displays.
      // Keep sampling the same motion assertions until it settles or times out.
      const settleDeadline = performance.now() + 1500
      for (let i = 0; performance.now() < settleDeadline; i++) {
        await frame(); positions.push(viewport.scrollTop)
        if (i >= 34 && Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) < 1) break
      }
      check(positions.at(-1) > oldTop, 'Scroll did not follow growth')
      check(Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) < 1, 'Scroll failed to settle at the bottom')
      const steps = positions.map((p, i) => p - (i ? positions[i - 1] : oldTop))
      check(steps.every(step => step >= -0.1), 'Follow reversed direction')
      check(Math.max(...steps) < 24, 'Follow jumped a whole line')
      sticky = false; viewport.scrollTop -= 150
      const readerTop = viewport.scrollTop
      render(text + '\n\n读者向上滚动后的新段落。', 'scroll')
      await painted(); await sleep(240)
      check(viewport.scrollTop === readerTop, 'Follow fought the reader')
      sticky = true; viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight
      render(text + '\n\n读者向上滚动后的新段落。', 'scroll', false)
      const footer = mount.querySelector('[data-response-actions]')
      const footerTop = footer.getBoundingClientRect().top
      await sleep(240)
      check(Math.abs(footer.getBoundingClientRect().top - footerTop) < 1, 'Completion moved the footer without new content')
      results.scroll = { maxFrameStep: Math.max(...steps), bottomError: Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop), readerControl: 'passed' }
      results.defaultMotion = 'opacity only'
      window.__streamingStability = results
    } finally {
      resize.disconnect(); follow.dispose(); root.unmount(); host.remove()
    }
  })().catch(error => { window.__streamingStability = { error: String(error), stack: error.stack } })
})
await page.waitForFunction(() => window.__streamingStability, undefined, { timeout: 45000 })
const result = await page.evaluate(() => window.__streamingStability)
console.log(result)
await page.cdp('Page.stopScreencast')
if (result.error) throw Error(result.error)
if (config.finish !== false) await task.finish({ keep: [] })
