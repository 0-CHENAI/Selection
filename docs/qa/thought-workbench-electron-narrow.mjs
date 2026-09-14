import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9333'
const OUT_JSON = new URL('./thought-workbench-electron-narrow.json', import.meta.url)
const OUT_PNG = new URL('./thought-workbench-electron-narrow.png', import.meta.url)
const OUT_PNG_SCROLLED = new URL('./thought-workbench-electron-narrow-scrolled.png', import.meta.url)

class CdpSession {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
      if (message.id == null) return
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.ws.close()
  }
}

function waitOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', (error) => reject(error), { once: true })
  })
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) =>
    target.type === 'page'
    && /localhost:5183|vite|index\.html|selection/i.test(`${target.url} ${target.title}`)
    && !/devtools/i.test(target.url)
  ) ?? targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  if (!page) {
    writeFileSync(OUT_JSON, `${JSON.stringify({ ok: false, error: 'no renderer page', targets }, null, 2)}\n`)
    throw new Error('No Electron renderer page on CDP 9333')
  }

  const version = await fetch(`${CDP}/json/version`).then((response) => response.json())
  const browserSession = new CdpSession(new WebSocket(version.webSocketDebuggerUrl))
  await waitOpen(browserSession.ws)
  let windowInfo = null
  let afterResize = null
  try {
    windowInfo = await browserSession.send('Browser.getWindowForTarget', { targetId: page.id })
    await browserSession.send('Browser.setWindowBounds', {
      windowId: windowInfo.windowId,
      bounds: { windowState: 'normal', left: 40, top: 40, width: 800, height: 700 },
    })
    await sleep(400)
    afterResize = await browserSession.send('Browser.getWindowForTarget', { targetId: page.id })
  } catch (error) {
    windowInfo = { error: String(error) }
  } finally {
    browserSession.close()
  }

  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  if (!afterResize?.bounds) {
    await session.send('Runtime.evaluate', {
      expression: 'window.resizeTo(800, 700)',
      returnByValue: true,
    })
    await sleep(400)
  }

  await session.send('Page.reload', { ignoreCache: true })
  await sleep(1500)

  const dismissOnboarding = await session.send('Runtime.evaluate', {
    expression: `(() => {
      const buttons = [...document.querySelectorAll('button')]
      const skip = buttons.find((button) => /稍后设置|Skip|稍后再说/.test(button.textContent || ''))
      if (!skip) return { skipped: false, labels: buttons.slice(0, 20).map((button) => (button.textContent || '').trim()) }
      skip.click()
      return { skipped: true, label: (skip.textContent || '').trim() }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  await sleep(600)

  const clickBoard = await session.send('Runtime.evaluate', {
    expression: `(() => {
      const clickByText = (needles) => {
        const buttons = [...document.querySelectorAll('button')]
        const board = buttons.find((button) => {
          const label = (button.getAttribute('aria-label') || button.textContent || '').replace(/\\s+/g, '')
          return needles.some((needle) => label.includes(needle.replace(/\\s+/g, '')))
        })
        if (!board) return { clicked: false, labels: buttons.slice(0, 40).map((button) => (button.textContent || '').trim()) }
        board.click()
        return { clicked: true, label: (board.textContent || '').trim(), pressed: board.getAttribute('aria-pressed') }
      }
      return clickByText(['新建编排', '创建编排'])
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  await sleep(800)

  const opened = await session.send('Runtime.evaluate', {
    expression: `(() => {
      const wait = (predicate, timeout = 8000) => new Promise((resolve) => {
        const started = Date.now()
        const tick = () => {
          const value = predicate()
          if (value || Date.now() - started > timeout) return resolve(value)
          requestAnimationFrame(tick)
        }
        tick()
      })
      return wait(() => document.querySelector('[data-testid="thought-canvas-split"]'))
        .then((el) => ({ found: Boolean(el), title: document.title, href: location.href }))
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })

  const metrics = await session.send('Runtime.evaluate', {
    expression: `(() => {
      const box = (el) => {
        if (!el) return null
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return {
          height: Math.round(rect.height),
          width: Math.round(rect.width),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          minHeight: style.minHeight,
          overflowY: style.overflowY,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }
      }
      const split = document.querySelector('[data-testid="thought-canvas-split"]')
      const stage = document.querySelector('[data-testid="thought-canvas-stage"]')
      const editor = document.querySelector('[data-testid="thought-canvas-editor"]')
      const toolbar = document.querySelector('[data-testid="thought-canvas-toolbar"]')
      const proposal = [...document.querySelectorAll('details')].find((item) => /AI/.test(item.textContent || ''))
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        chrome: {
          title: document.title,
          thoughtTitle: document.body.innerText.includes('思考') || document.body.innerText.includes('新建编排'),
          proposalOpen: proposal?.open ?? null,
          toolbarButtons: toolbar ? toolbar.querySelectorAll('button').length : 0,
        },
        toolbar: box(toolbar),
        split: box(split),
        stage: box(stage),
        editor: box(editor),
        crushed: editor ? editor.getBoundingClientRect().height < 80 : true,
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })

  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT_PNG, Buffer.from(shot.data, 'base64'))

  const scrolled = await session.send('Runtime.evaluate', {
    expression: `(() => {
      const split = document.querySelector('[data-testid="thought-canvas-split"]')
      const editor = document.querySelector('[data-testid="thought-canvas-editor"]')
      if (split) split.scrollTop = split.scrollHeight
      return {
        splitScrollTop: split?.scrollTop ?? null,
        editorInView: editor ? editor.getBoundingClientRect().top < window.innerHeight && editor.getBoundingClientRect().bottom > 0 : false,
        editorHeight: editor ? Math.round(editor.getBoundingClientRect().height) : null,
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  const shotScrolled = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT_PNG_SCROLLED, Buffer.from(shotScrolled.data, 'base64'))

  const report = {
    viewportRequested: '800x700 window',
    target: { title: page.title, url: page.url, id: page.id },
    windowBefore: windowInfo?.bounds ?? windowInfo,
    windowAfter: afterResize?.bounds ?? afterResize,
    dismissOnboarding: dismissOnboarding.result?.value ?? dismissOnboarding,
    clickBoard: clickBoard.result?.value ?? clickBoard,
    opened: opened.result?.value ?? opened,
    metrics: metrics.result?.value ?? metrics,
    scrolled: scrolled.result?.value ?? scrolled,
    editorUsable: (metrics.result?.value?.editor?.height ?? 0) >= 240,
    editorNotCrushed: (metrics.result?.value?.editor?.height ?? 0) >= 80,
    stageBounded: (metrics.result?.value?.stage?.height ?? 9999) <= 280,
    toolbarSingleRow: (metrics.result?.value?.toolbar?.height ?? 99) <= 40,
    proposalCollapsed: metrics.result?.value?.chrome?.proposalOpen === false,
  }
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  session.close()
  if (!report.metrics?.editor || !report.editorUsable || !report.stageBounded || !report.toolbarSingleRow || !report.proposalCollapsed) {
    process.exitCode = 1
  }
}

await main()
