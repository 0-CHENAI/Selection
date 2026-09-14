import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9333'
const OUT = new URL('./thought-workbench-agent-permission.json', import.meta.url)
const PNG = new URL('./thought-workbench-agent-permission.png', import.meta.url)

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
      if (value || Date.now() - started > ${timeoutMs}) resolve({ value, elapsed: Date.now() - started })
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
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2200)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1500)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '问答') || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `(() => {
    const title = document.querySelector('input[aria-label="标题"]')
    const question = document.querySelector('textarea[aria-label="问答"]')
    const mode = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'agent'))
    const model = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Laufry/.test(option.textContent || '')))
    if (title) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'Agent bash permission')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (question) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(question, '必须调用 Bash 工具执行：echo permission-probe-isolated。不要用 submit_answer 或其它工具代替。执行前应等待我审批。')
      question.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (mode) {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(mode, 'agent')
      mode.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (model) {
      const option = [...model.options].find((item) => /Laufry/.test(item.textContent || ''))
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(model, option.value)
      model.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return true
  })()`)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '上下文预览') || {}).click?.()`)
  report.preview = await waitFor(session, `document.body.innerText.includes('[tools]')`, 45000)
  write()
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '生成') || {}).click?.()`)
  report.opened = await waitFor(session, `document.body.innerText.includes('打开会话') || document.body.innerText.includes('需要权限')`, 120000)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => /打开会话/.test(item.textContent || '')) || {}).click?.()`)
  report.permission = await waitFor(session, `document.body.innerText.includes('需要权限')`, 120000)
  report.denied = await evaluate(session, `(() => {
    const deny = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '不允许')
    deny?.click()
    return Boolean(deny)
  })()`)
  await sleep(800)
  report.afterDeny = (await evaluate(session, 'document.body.innerText')).slice(-900)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '取消') || {}).click?.()`)
  await sleep(600)
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))
  report.finishedAt = new Date().toISOString()
  write()
  console.log(JSON.stringify({ preview: report.preview, permission: report.permission, denied: report.denied }, null, 2))
  session.close()
}

await main()
