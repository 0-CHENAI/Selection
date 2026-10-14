// Start Electron Vite, then: ego-browser nodejs < scripts/qa-work-status-loading.js
// Optional globalThis.workStatusLoadingQA = { spaceId, finish: false }.
const config = globalThis.workStatusLoadingQA ?? {}
const task = await taskSpace(config.spaceId ?? '工作状态加载图标回归')
console.log({ spaceId: task.spaceId })
const page = task.page('p1')
await page.goto('http://localhost:5173/playground.html')
await page.waitForSelector('#root > *')
await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 400, maxHeight: 300, everyNthFrame: 1 })
await page.evaluate(() => {
  window.__workStatusLoading = null
  void (async () => {
    const urls = performance.getEntriesByType('resource').map(e => e.name)
    const reactUrl = urls.find(u => /\/react\.js\?/.test(u))
    const React = (await import(reactUrl)).default
    const { createRoot } = (await import(urls.find(u => /\/react-dom_client\.js\?/.test(u)))).default
    const { flushSync } = (await import(reactUrl.replace('/react.js?', '/react-dom.js?'))).default
    const base = urls.find(u => u.includes('/apps/electron/node_modules/')).split('/apps/electron/')[0]
    const renderer = location.origin + '/'
    const { Provider } = await import(urls.find(u => /\/jotai\.js\?/.test(u)))
    const { ThemeProvider } = await import(renderer + 'context/ThemeContext.tsx')
    const { PlaygroundAppShellProvider } = await import(renderer + 'playground/PlaygroundAppShellProvider.tsx')
    const { MobilePlaygroundProviders } = await import(renderer + 'playground/demos/mobile-webui/MobilePlaygroundProviders.tsx')
    const { buildMockSession } = await import(renderer + 'playground/demos/mobile-webui/mock-mobile-data.ts')
    const { ChatDisplay } = await import(renderer + 'components/app-shell/ChatDisplay.tsx')
    const { TooltipProvider } = await import(base + '/packages/ui/src/components/tooltip.tsx')
    const { i18n } = await import(base + '/packages/shared/src/i18n/index.ts')
    await i18n.changeLanguage('zh-Hans')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--background);padding:30px'
    document.body.append(host)
    const root = createRoot(host)
    const now = Date.now()
    const user = { id: 'u1', role: 'user', content: '解释蒙提霍尔问题。', timestamp: now - 3000 }
    const thinking = { id: 'thinking', role: 'assistant', content: '', isIntermediate: true, isStreaming: true, turnId: 't1', timestamp: now - 2000 }
    const tool = { id: 'tool', role: 'tool', toolName: 'Read', toolUseId: 'read', content: '', isStreaming: true, toolStatus: 'running', timestamp: now - 1500, turnId: 't1' }
    // Expansion is persisted per session. Repeated QA runs must start collapsed
    // without clearing or modifying the user's existing expansion preferences.
    let session = buildMockSession(`loading-qa-${crypto.randomUUID()}`, { messages: [user], isProcessing: true, processingStartedAt: now - 3000, currentStatus: { message: '哼哼运转…' } })
    const noop = () => {}
    const h = React.createElement
    const render = () => flushSync(() => root.render(h(Provider, null, h(ThemeProvider, null, h(PlaygroundAppShellProvider, null,
      h(TooltipProvider, null, h(MobilePlaygroundProviders, { session }, h(ChatDisplay, {
        session, onSendMessage: noop, onOpenFile: noop, onOpenUrl: noop, hideComposer: true, compactMode: true,
      }))))))))
    const check = (value, message) => { if (!value) throw Error(message) }
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const visible = node => {
      const rect = node.getBoundingClientRect()
      if (!rect.width || !rect.height) return false
      let opacity = 1
      for (let element = node; element && host.contains(element); element = element.parentElement) {
        const css = getComputedStyle(element)
        if (css.visibility === 'hidden' || css.display === 'none' || element.getAttribute('aria-hidden') === 'true') return false
        opacity *= Number(css.opacity)
        if (/(hidden|clip)/.test(css.overflowY)) {
          const bounds = element.getBoundingClientRect()
          if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return false
        }
      }
      return opacity > 0.05
    }
    const active = () => [...host.querySelectorAll('[data-status="working"]')].filter(visible)
    const samples = []
    const sample = async (name, expected = 1) => {
      let peak = 0
      for (let i = 0; i < 28; i++) {
        await frame()
        peak = Math.max(peak, active().length)
      }
      check(active().length === expected, `${name}: expected ${expected} active loading icon(s), found ${active().length}`)
      check(peak <= expected, `${name}: transient duplicate loading icons (${peak})`)
      samples.push({ name, peak, settled: active().length })
    }
    try {
      render(); await sample('before-first-assistant')
      session = { ...session, messages: [user, thinking] }; render(); await sample('empty-thinking')
      session = { ...session, messages: [user, { ...thinking, isIntermediate: false }] }; render(); await sample('buffering')
      session = { ...session, messages: [user, tool] }; render(); await sample('running-tool-collapsed')
      session = { ...session, messages: [user, { ...tool, isStreaming: false, content: '读取完成。', toolStatus: 'completed' }] }; render(); await sample('between-tools')
      const header = [...host.querySelectorAll('button[aria-expanded="false"]')].find(button => button.textContent.includes('读取文件'))
      check(header, 'Work header not found')
      header.click(); await sample('between-tools-expanded')
      session = { ...session, messages: [user, { ...tool, isStreaming: false, content: '读取完成。', toolStatus: 'completed' }, { id: 'answer', role: 'assistant', turnId: 't1', content: '换门胜率为三分之二。', isStreaming: true, timestamp: now }] }
      render(); await sample('streaming-answer')
      session = { ...session, isProcessing: false, processingStartedAt: undefined, currentStatus: undefined, messages: session.messages.map(message => ({ ...message, isStreaming: false })) }
      render(); await sample('completed', 0)
      check(host.querySelector('[data-chat-processing="completed"] [data-status="done"]'), 'Completed check mark is missing')
      window.__workStatusLoading = { samples, completed: 'check mark retained' }
    } finally { root.unmount(); host.remove() }
  })().catch(error => { window.__workStatusLoading = { error: String(error), stack: error.stack } })
})
await page.waitForFunction(() => window.__workStatusLoading, undefined, { timeout: 45000 })
const result = await page.evaluate(() => window.__workStatusLoading)
console.log(result)
await page.cdp('Page.stopScreencast')
if (result.error) throw Error(result.error)
if (config.finish !== false) await task.finish({ keep: [] })
