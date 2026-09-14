import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CDP = 'http://127.0.0.1:9333'
const ROOT = '/tmp/selection-thought-wb-qa/workspaces/my-workspace'
const OUT = new URL('./thought-workbench-conflict-ui.json', import.meta.url)
const PNG = new URL('./thought-workbench-conflict-ui.png', import.meta.url)

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
  return result.result?.value
}

async function main() {
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  if (!page) throw new Error('No Electron renderer')
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(1800)
  await evaluate(session, `window.resizeTo(1100, 800)`)
  await sleep(300)
  await evaluate(session, `(() => {
    const skip = [...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || ''))
    skip?.click()
    const board = [...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || ''))
    board?.click()
    return { skipped: Boolean(skip), board: Boolean(board) }
  })()`)
  await sleep(1200)

  const opened = await evaluate(session, `(() => new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const title = document.querySelector('input[aria-label]')
      if (title || Date.now() - started > 8000) resolve({ found: Boolean(title), labels: [...document.querySelectorAll('input')].map((el) => el.getAttribute('aria-label')) })
      else requestAnimationFrame(tick)
    }
    tick()
  }))()`)

  const identity = await evaluate(session, `(() => new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const select = document.querySelector('select[aria-label]')
      const saved = document.body.innerText.includes('已保存')
      if ((select?.value && saved) || Date.now() - started > 8000) resolve({ id: select?.value ?? null, saved })
      else setTimeout(tick, 150)
    }
    tick()
  }))()`)
  const docPath = identity.id ? join(ROOT, 'thought-workbenches', identity.id, 'document.json') : null
  const newest = docPath && existsSync(docPath) ? { id: identity.id, path: docPath, doc: JSON.parse(readFileSync(docPath, 'utf8')) } : null

  const typed = await evaluate(session, `(() => {
    const input = [...document.querySelectorAll('input')].find((el) => (el.getAttribute('aria-label') || '') === '标题')
    if (!input) return { typed: false }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    input.focus()
    setter.call(input, 'local-conflict-qa')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { typed: true, value: input.value }
  })()`)

  if (newest) {
    const current = JSON.parse(readFileSync(newest.path, 'utf8'))
    writeFileSync(newest.path, JSON.stringify({
      ...current,
      revision: current.revision + 1,
      title: 'remote-conflict-qa',
      updatedAt: new Date().toISOString(),
    }))
  }
  await sleep(1600)

  const panel = await evaluate(session, `(() => {
    const el = document.querySelector('[data-testid="thought-conflict-panel"]')
    return {
      found: Boolean(el),
      text: el?.textContent ?? '',
      buttons: [...(el?.querySelectorAll('button') ?? [])].map((button) => (button.textContent || '').trim()),
    }
  })()`)

  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))

  let resolved = null
  if (panel.found) {
    await evaluate(session, `(() => {
      const button = [...document.querySelectorAll('[data-testid="thought-conflict-panel"] button')].find((item) => /保留当前/.test(item.textContent || ''))
      button?.click()
      return Boolean(button)
    })()`)
    await sleep(1200)
    resolved = newest ? JSON.parse(readFileSync(newest.path, 'utf8')) : null
  }

  const tasksDir = join(ROOT, 'tasks')
  const report = {
    opened,
    identity,
    document: newest ? { id: newest.id, revision: newest.doc.revision } : null,
    typed,
    panel,
    resolved: resolved ? { id: resolved.id, revision: resolved.revision, title: resolved.title, taskSlug: resolved.taskSlug ?? null } : null,
    createdTask: existsSync(tasksDir) ? readdirSync(tasksDir) : [],
    keptMine: resolved?.title === 'local-conflict-qa',
    noTaskStarted: !existsSync(tasksDir) || readdirSync(tasksDir).length === 0,
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  session.close()
  if (!report.panel.found || !report.keptMine || !report.noTaskStarted) process.exitCode = 1
}

await main()
