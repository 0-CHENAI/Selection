import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9333'
const OUT = new URL('./thought-workbench-proposal-stale.json', import.meta.url)
const PNG = new URL('./thought-workbench-proposal-stale.png', import.meta.url)

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
async function waitFor(session, expression, timeoutMs) {
  return evaluate(session, `(() => new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const value = (${expression})
      if (value || Date.now() - started > ${timeoutMs}) resolve({ value: Boolean(value), elapsed: Date.now() - started })
      else setTimeout(tick, 250)
    }
    tick()
  }))()`)
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
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2000)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1600)
  await evaluate(session, `(() => {
    const title = document.querySelector('input[aria-label="标题"]')
    if (title) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'Proposal stale QA')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const summary = [...document.querySelectorAll('summary')].find((el) => /AI 辅助编排/.test(el.textContent || ''))
    const details = summary?.closest('details')
    if (details) details.open = true
    const area = document.querySelector('textarea[aria-label="目标或修改意见"]')
    if (area) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, '创建一个 schema_version 3 任务，id 必须是 proposal-stale-qa。只要一个 session 节点，id 为 ask，prompt 为：回复 ok。不要加其他节点或工具。')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return { title: Boolean(title), area: Boolean(area), open: Boolean(details?.open) }
  })()`)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '生成提案') || {}).click?.()`)
  report.generated = await waitFor(session, `document.body.innerText.includes('检查节点与依赖') || document.body.innerText.includes('提案生成失败') || document.body.innerText.includes('提案超时')`, 200000)
  report.beforeEdit = await evaluate(session, `({
    review: document.body.innerText.includes('检查节点与依赖'),
    apply: Boolean([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '应用到草稿')),
    stale: document.body.innerText.includes('生成期间草稿已修改'),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent || ''),
  })`)
  write()
  report.yaml = await evaluate(session, `(() => {
    const tab = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === 'YAML')
    tab?.click()
    return Boolean(tab)
  })()`)
  await sleep(500)
  report.edited = await evaluate(session, `(() => {
    const yaml = document.querySelector('textarea[aria-label="YAML"]')
    if (!yaml) return { ok: false }
    const next = (yaml.value || '') + '\\n# stale-edit-marker\\n'
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(yaml, next)
    yaml.dispatchEvent(new Event('input', { bubbles: true }))
    yaml.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, length: next.length }
  })()`)
  await sleep(400)
  report.applied = await evaluate(session, `(() => {
    const apply = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '应用到草稿')
    apply?.click()
    return Boolean(apply)
  })()`)
  await sleep(600)
  report.after = await evaluate(session, `({
    stale: document.body.innerText.includes('生成期间草稿已修改'),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent || ''),
    status: [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent || ''),
    text: document.body.innerText.slice(0, 1600),
  })`)
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))
  report.finishedAt = new Date().toISOString()
  write()
  console.log(JSON.stringify({
    generated: report.generated,
    beforeEdit: report.beforeEdit,
    edited: report.edited,
    applied: report.applied,
    stale: report.after?.stale,
    alerts: report.after?.alerts,
  }, null, 2))
  session.close()
}

await main()
