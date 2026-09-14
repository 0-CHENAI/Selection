import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CDP = 'http://127.0.0.1:9333'
const TASK = '/tmp/selection-thought-wb-qa/workspaces/my-workspace/tasks/legacy-v1/task.yaml'
const ORIG = `${TASK}.orig`
const OUT = new URL('./thought-workbench-migration-ui.json', import.meta.url)
const PNG = new URL('./thought-workbench-migration-ui.png', import.meta.url)

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
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2000)
  await evaluate(session, `window.resizeTo(1100, 800)`)
  await evaluate(session, `(() => {
    [...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || ''))?.click()
  })()`)
  await sleep(800)
  await evaluate(session, `(() => {
    [...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || ''))?.click()
  })()`)
  await sleep(1500)

  const switched = await evaluate(session, `(() => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'legacyv1wb'))
    if (!select) return { switched: false, options: [...document.querySelectorAll('select option')].map((option) => option.value) }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    setter.call(select, 'legacyv1wb')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return { switched: true }
  })()`)
  await sleep(1500)

  const canvas = await evaluate(session, `(() => {
    const tab = [...document.querySelectorAll('button')].find((button) => /编排图/.test(button.textContent || ''))
    tab?.click()
    return { clicked: Boolean(tab) }
  })()`)
  await sleep(800)

  const ui = await evaluate(session, `({
    text: document.body.innerText,
    banner: document.body.innerText.includes('此文件为 v1') || document.body.innerText.includes('schema_version: 2'),
    history: document.body.innerText.includes('.history'),
  })`)
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))

  const yaml = readFileSync(TASK, 'utf8')
  const original = readFileSync(ORIG, 'utf8')
  const report = {
    switched,
    canvas,
    banner: ui.banner,
    yamlUnchanged: yaml === original,
    yaml,
    snippet: ui.text.slice(0, 1200),
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, snippet: ui.text.match(/此文件[\s\S]{0,120}|v1[\s\S]{0,80}|schema_version[\s\S]{0,80}/)?.[0] ?? ui.text.slice(0, 400) }, null, 2))
  session.close()
  if (!report.banner || !report.yamlUnchanged) process.exitCode = 1
}

await main()
