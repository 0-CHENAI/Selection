import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9333'
const OUT = new URL('./thought-workbench-theme-a11y.json', import.meta.url)
const PNG_LIGHT = new URL('./thought-workbench-theme-light.png', import.meta.url)
const PNG_DARK = new URL('./thought-workbench-theme-dark.png', import.meta.url)
const PNG_FOCUS = new URL('./thought-workbench-keyboard-focus.png', import.meta.url)

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
  close() { this.ws.close() }
}
function waitOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', (error) => reject(error), { once: true })
  })
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate failed')
  return result.result?.value
}
async function shot(session, dest) {
  const image = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(dest, Buffer.from(image.data, 'base64'))
}

const THEME_PROBE = `(() => {
  const root = document.documentElement
  const split = document.querySelector('[data-testid="thought-canvas-split"]')
  const stage = document.querySelector('[data-testid="thought-canvas-stage"]')
  const editor = document.querySelector('[data-testid="thought-canvas-editor"]')
  const toolbar = document.querySelector('[data-testid="thought-canvas-toolbar"]')
  const styleOf = (el) => {
    if (!el) return null
    const computed = getComputedStyle(el)
    return { bg: computed.backgroundColor, fg: computed.color, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }
  }
  return {
    className: root.className,
    theme: root.dataset.theme || null,
    colorScheme: getComputedStyle(root).colorScheme,
    htmlBg: getComputedStyle(root).backgroundColor,
    split: styleOf(split),
    stage: styleOf(stage),
    editor: styleOf(editor),
    toolbar: styleOf(toolbar),
    testids: {
      split: Boolean(split),
      stage: Boolean(stage),
      editor: Boolean(editor),
      toolbar: Boolean(toolbar),
    },
  }
})()`

const A11Y_PROBE = `(() => {
  const root = document.querySelector('[data-testid="thought-canvas-split"]') || document.body
  const nameOf = (el) => {
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
    if (labelled) return labelled
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
    return text.slice(0, 40)
  }
  const unlabeled = [...root.querySelectorAll('button, input, textarea, select')].filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) return false
    const box = el.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) return false
    return !nameOf(el)
  }).map((el) => el.tagName)
  const labels = ['标题', '草稿', '问答', '添加材料', 'YAML']
  const found = Object.fromEntries(labels.map((label) => [label, Boolean(document.querySelector('[aria-label="' + label + '"]'))]))
  return {
    unlabeledVisibleControls: unlabeled.length,
    ariaLabels: found,
    roles: {
      status: document.querySelectorAll('[role="status"]').length,
      alert: document.querySelectorAll('[role="alert"]').length,
    },
  }
})()`

async function leaveSettings(session) {
  await evaluate(session, `(() => {
    const chat = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim().startsWith('普通会话'))
    chat?.click()
    return Boolean(chat)
  })()`)
  await sleep(500)
}

async function openBoard(session) {
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(300)
  await leaveSettings(session)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1400)
}

async function main() {
  const report = { startedAt: new Date().toISOString() }
  const write = () => writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  if (!page) throw new Error('No Electron renderer')
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await session.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {})
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2000)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await openBoard(session)

  report.light = await evaluate(session, THEME_PROBE)
  report.a11y = await evaluate(session, A11Y_PROBE)
  await shot(session, PNG_LIGHT)
  write()

  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(800)
  report.settingsNav = await evaluate(session, `(() => {
    const appearance = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"]')].find((el) => /外观|主题、字体/.test(el.textContent || ''))
    appearance?.click()
    return { clicked: Boolean(appearance), text: appearance?.textContent?.trim() || null }
  })()`)
  await sleep(600)
  report.darkClick = await evaluate(session, `(() => {
    const dark = [...document.querySelectorAll('button, [role="radio"]')].find((el) => (el.textContent || '').trim() === '深色' || (el.getAttribute('aria-label') || '').includes('深色'))
    dark?.click()
    return { clicked: Boolean(dark), text: dark?.textContent?.trim() || dark?.getAttribute('aria-label') || null }
  })()`)
  await sleep(500)
  await openBoard(session)
  report.dark = await evaluate(session, THEME_PROBE)
  await shot(session, PNG_DARK)
  write()

  report.selectedNodeA11y = await evaluate(session, `(() => {
    const add = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '问答')
    add?.click()
    const question = Boolean(document.querySelector('textarea[aria-label="问答"]'))
    const yamlTab = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === 'YAML')
    yamlTab?.click()
    const yaml = Boolean(document.querySelector('textarea[aria-label="YAML"]'))
    const thought = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '思考')
    thought?.click()
    return {
      question,
      yaml,
      title: Boolean(document.querySelector('input[aria-label="标题"]')),
    }
  })()`)
  await sleep(400)

  report.keyboard = await evaluate(session, `(() => {
    const title = document.querySelector('input[aria-label="标题"]')
    title?.focus()
    return { focused: document.activeElement?.getAttribute('aria-label') || null }
  })()`)
  const tabStops = []
  for (let i = 0; i < 12; i += 1) {
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await sleep(80)
    tabStops.push(await evaluate(session, `(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      return {
        tag: el.tagName,
        label: el.getAttribute('aria-label') || (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 32),
        testid: el.getAttribute('data-testid'),
      }
    })()`))
  }
  report.keyboard.tabStops = tabStops.filter(Boolean)
  await shot(session, PNG_FOCUS)

  report.restoreLight = await evaluate(session, `(() => {
    const settings = [...document.querySelectorAll('button')].find((button) => /设置/.test(button.textContent || ''))
    settings?.click()
    return Boolean(settings)
  })()`)
  await sleep(500)
  await evaluate(session, `(() => {
    const appearance = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"]')].find((el) => /外观|主题、字体/.test(el.textContent || ''))
    appearance?.click()
    const light = [...document.querySelectorAll('button, [role="radio"]')].find((el) => (el.textContent || '').trim() === '浅色')
    light?.click()
    return Boolean(light)
  })()`)
  report.finishedAt = new Date().toISOString()
  write()
  console.log(JSON.stringify({
    lightClass: report.light?.className,
    darkClass: report.dark?.className,
    themeChanged: report.light?.className !== report.dark?.className,
    a11y: report.a11y,
    tabStops: report.keyboard?.tabStops?.length,
    darkClick: report.darkClick,
  }, null, 2))
  session.close()
}

await main()
