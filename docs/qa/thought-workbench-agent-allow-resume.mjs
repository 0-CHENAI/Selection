import { existsSync, writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9333'
const OUT = new URL('./thought-workbench-agent-allow-resume.json', import.meta.url)
const PNG_DENY = new URL('./thought-workbench-agent-deny.png', import.meta.url)
const PNG_RECOVER = new URL('./thought-workbench-agent-recover.png', import.meta.url)
const PNG_ALLOW = new URL('./thought-workbench-agent-allow.png', import.meta.url)
const PROBE = '/tmp/selection-thought-wb-qa-probe/write-probe.txt'
const DRAFT = 'Agent write permission'

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
      else setTimeout(tick, 200)
    }
    tick()
  }))()`)
}
async function shot(session, dest) {
  const image = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(dest, Buffer.from(image.data, 'base64'))
}

const CLICK_VISIBLE_PERMISSION = `(label) => {
  const visible = [...document.querySelectorAll('[data-tutorial="permission-banner"]')].filter((el) => {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
  })
  const banner = visible.at(-1)
  if (!banner) return { ok: false, reason: 'no-visible-banner', banners: document.querySelectorAll('[data-tutorial="permission-banner"]').length }
  const button = [...banner.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === label)
  if (!button || button.disabled) return { ok: false, reason: 'no-button', label, disabled: Boolean(button?.disabled) }
  button.click()
  return { ok: true, label }
}`

async function openDraft(session) {
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2000)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1400)
  return evaluate(session, `(() => {
    const select = document.querySelector('select[aria-label="草稿"]')
    if (!select) return { ok: false, options: [...document.querySelectorAll('select option')].map((option) => option.textContent || '').slice(0, 16) }
    const option = [...select.options].find((item) => (item.textContent || '').includes(${JSON.stringify(DRAFT)}))
    if (!option) return { ok: false, options: [...select.options].map((item) => item.textContent || '') }
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, id: option.value }
  })()`)
}

async function startAgentGenerate(session) {
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '问答') || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `(() => {
    const question = document.querySelector('textarea[aria-label="问答"]')
    const mode = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'agent'))
    const model = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Laufry/.test(option.textContent || '')))
    if (question && !/write-probe/.test(question.value || '')) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(question, '必须调用 Bash 执行：touch /tmp/selection-thought-wb-qa-probe/write-probe.txt 。不要用 echo，不要用只读命令，不要用 submit_answer 代替。')
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
  await waitFor(session, `document.body.innerText.includes('[tools]')`, 30000)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '生成') || {}).click?.()`)
  await waitFor(session, `document.body.innerText.includes('打开会话') || document.body.innerText.includes('需要权限')`, 90000)
  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => /打开会话/.test(item.textContent || '')) || {}).click?.()`)
  return waitFor(session, `document.body.innerText.includes('需要权限')`, 90000)
}

async function main() {
  const report = { startedAt: new Date().toISOString(), probeBefore: existsSync(PROBE) }
  const write = () => writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  if (!page) throw new Error('No Electron renderer')
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')

  const alreadyOpen = await evaluate(session, 'document.body.innerText.includes("需要权限")')
  if (!alreadyOpen) {
    report.opened = await openDraft(session)
    write()
    const hasPermission = await evaluate(session, 'document.body.innerText.includes("需要权限")')
    if (!hasPermission) {
      await evaluate(session, `([...document.querySelectorAll('button')].find((item) => /打开会话/.test(item.textContent || '')) || {}).click?.()`)
      report.permissionBeforeDeny = await waitFor(session, `document.body.innerText.includes('需要权限')`, 20000)
    }
  }

  report.deny = await evaluate(session, `(${CLICK_VISIBLE_PERMISSION})('不允许')`)
  report.permissionAfterDeny = await waitFor(session, `!document.body.innerText.includes('需要权限')`, 8000)
  await sleep(800)
  await shot(session, PNG_DENY)
  report.probeAfterDeny = existsSync(PROBE)
  write()

  report.backToDraft = await openDraft(session)
  await sleep(1200)
  report.cancel = await evaluate(session, `(() => {
    const cancel = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '取消')
    cancel?.click()
    return Boolean(cancel)
  })()`)
  await sleep(800)
  write()

  report.reopened = await openDraft(session)
  await sleep(1500)
  const recovered = await evaluate(session, 'document.body.innerText')
  report.recover = {
    permissionAutoShown: recovered.includes('需要权限'),
    probeStillMissing: !existsSync(PROBE),
    hasOpenSession: recovered.includes('打开会话'),
    hasCancel: recovered.includes('取消'),
  }
  await shot(session, PNG_RECOVER)
  write()

  report.permissionBeforeAllow = await startAgentGenerate(session)
  report.allow = await evaluate(session, `(${CLICK_VISIBLE_PERMISSION})('允许')`)
  const probeWait = Date.now()
  while (!existsSync(PROBE) && Date.now() - probeWait < 20000) await sleep(400)
  await sleep(1200)
  await shot(session, PNG_ALLOW)
  report.probeAfterAllow = existsSync(PROBE)
  report.after = (await evaluate(session, 'document.body.innerText')).slice(-700)
  report.finishedAt = new Date().toISOString()
  write()
  console.log(JSON.stringify({
    probeBefore: report.probeBefore,
    deny: report.deny,
    probeAfterDeny: report.probeAfterDeny,
    recover: report.recover,
    allow: report.allow,
    probeAfterAllow: report.probeAfterAllow,
  }, null, 2))
  session.close()
}

await main()
