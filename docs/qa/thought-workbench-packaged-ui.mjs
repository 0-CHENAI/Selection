import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9334'
const OUT = new URL('./thought-workbench-packaged-ui.json', import.meta.url)
const PNG = new URL('./thought-workbench-packaged-ui.png', import.meta.url)

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

async function main() {
  const report = { startedAt: new Date().toISOString() }
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  if (!page) throw new Error('No packaged renderer')
  report.url = page.url
  report.packagedRenderer = page.url.startsWith('file://') && page.url.includes('release/mac-arm64/Selection.app')
  report.notVite = !/localhost:51/.test(page.url)
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await sleep(400)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(400)
  report.clickedBoard = await evaluate(session, `(() => {
    const board = [...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || ''))
    board?.click()
    return Boolean(board)
  })()`)
  await sleep(1600)
  report.ui = await evaluate(session, `({
    thought: Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '思考')),
    split: Boolean(document.querySelector('[data-testid="thought-canvas-split"]')),
    stage: Boolean(document.querySelector('[data-testid="thought-canvas-stage"]')),
    editor: Boolean(document.querySelector('[data-testid="thought-canvas-editor"]')),
    title: Boolean(document.querySelector('input[aria-label="标题"]')),
    textHasVite: document.body.innerText.includes('localhost:5183') || document.body.innerText.includes('localhost:5173'),
  })`)
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))
  report.finishedAt = new Date().toISOString()
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  session.close()
}

await main()
