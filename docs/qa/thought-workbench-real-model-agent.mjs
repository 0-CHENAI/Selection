import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9333'
const OUT = new URL('./thought-workbench-real-model-agent.json', import.meta.url)
const PNG = new URL('./thought-workbench-real-model-agent.png', import.meta.url)

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
      if (value || Date.now() - started > ${timeoutMs}) resolve(value)
      else setTimeout(tick, 250)
    }
    tick()
  }))()`)
}
function pageText(session) {
  return evaluate(session, `document.body.innerText`)
}

async function openNew(session) {
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2200)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1500)
}

async function main() {
  const report = { startedAt: new Date().toISOString() }
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await openNew(session)

  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '问答') || {}).click?.()`)
  await sleep(500)
  await evaluate(session, `(() => {
    const title = document.querySelector('input[aria-label="标题"]')
    const question = document.querySelector('textarea[aria-label="问答"]')
    const mode = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'agent'))
    const model = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Laufry/.test(option.textContent || '')))
    if (title) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'Agent permission QA')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (question) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(question, '请使用工具列出当前工作区根目录的文件名，只返回文件名。不要修改任何文件。')
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
    return { title: Boolean(title), question: Boolean(question), mode: mode?.value, model: model?.value }
  })()`)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '上下文预览') || {}).click?.()`)
  const preview = await waitFor(session, `document.body.innerText.includes('[tools]') || document.body.innerText.includes('失败')`, 60000)
  const previewText = await pageText(session)
  const toolCount = (previewText.match(/"name":/g) || []).length
  report.preview = {
    ready: Boolean(preview),
    hasTools: previewText.includes('[tools]'),
    toolCount,
    noToolsLine: previewText.includes('No tools are available'),
    excerpt: previewText.slice(previewText.indexOf('[model]'), previewText.indexOf('[model]') + 900),
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)

  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '生成') || {}).click?.()`)
  await waitFor(session, `document.body.innerText.includes('打开会话') || document.body.innerText.includes('需要权限') || document.body.innerText.includes('失败')`, 180000)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => /打开会话/.test(item.textContent || '')) || {}).click?.()`)
  const permission = await waitFor(session, `document.body.innerText.includes('需要权限')`, 180000)
  report.permission = {
    shown: Boolean(permission),
    text: (await pageText(session)).slice(-1200),
  }
  const denied = await evaluate(session, `(() => {
    const deny = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '不允许')
    deny?.click()
    return Boolean(deny)
  })()`)
  await sleep(800)
  report.denied = denied
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)

  await openNew(session)
  await evaluate(session, `(() => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Agent permission/.test(option.textContent || '')))
    if (!select) return false
    const option = [...select.options].find((item) => /Agent permission/.test(item.textContent || ''))
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(1500)
  const recovered = await pageText(session)
  report.recover = {
    permissionAutoShown: recovered.includes('需要权限'),
    excerpt: recovered.slice(0, 700),
  }

  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '问答') || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `(() => {
    const question = document.querySelector('textarea[aria-label="问答"]')
    const mode = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'agent'))
    if (question && !question.value.trim()) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(question, '请使用工具列出当前工作区根目录的文件名，只返回文件名。不要修改任何文件。')
      question.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (mode) {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(mode, 'agent')
      mode.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return true
  })()`)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '上下文预览') || {}).click?.()`)
  await waitFor(session, `document.body.innerText.includes('[tools]') || document.body.innerText.includes('失败')`, 60000)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '生成') || {}).click?.()`)
  await waitFor(session, `document.body.innerText.includes('打开会话') || document.body.innerText.includes('需要权限')`, 180000)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => /打开会话/.test(item.textContent || '')) || {}).click?.()`)
  await waitFor(session, `document.body.innerText.includes('需要权限')`, 180000)
  const allowed = await evaluate(session, `(() => {
    const allow = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '允许')
    allow?.click()
    return Boolean(allow)
  })()`)
  const done = await waitFor(session, `document.body.innerText.includes('config.json') || document.body.innerText.includes('tasks') || document.body.innerText.includes('失败')`, 180000)
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))
  report.allow = { allowed, done: Boolean(done), text: (await pageText(session)).slice(-1500) }
  report.finishedAt = new Date().toISOString()
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    previewTools: report.preview.hasTools,
    toolCount: report.preview.toolCount,
    permission: report.permission.shown,
    denied,
    recoverAuto: report.recover.permissionAutoShown,
    allowed,
  }, null, 2))
  session.close()
}

await main()
