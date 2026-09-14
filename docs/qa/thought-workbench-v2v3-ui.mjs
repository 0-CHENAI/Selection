import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CDP = 'http://127.0.0.1:9333'
const TASK = '/tmp/selection-thought-wb-qa/workspaces/my-workspace/tasks/legacy-v2/task.yaml'
const ORIG = `${TASK}.orig`
const HISTORY = '/tmp/selection-thought-wb-qa/workspaces/my-workspace/tasks/legacy-v2/.history'
const OUT = new URL('./thought-workbench-v2v3-ui.json', import.meta.url)
const PNG = new URL('./thought-workbench-v2v3-ui.png', import.meta.url)
const V3 = `schema_version: 3
id: legacy-v2
title: Legacy V2
goal: review a note
acceptance_criteria: done
nodes:
  - id: a
    prompt: hello
`

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

async function openBoard(session) {
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2000)
  await evaluate(session, 'window.resizeTo(1100, 860)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(700)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1400)
}

async function main() {
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await openBoard(session)

  const switched = await evaluate(session, `(() => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'legacyv2wb'))
    if (!select) return { ok: false, options: [...document.querySelectorAll('select option')].map((option) => option.value) }
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, 'legacyv2wb')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true }
  })()`)
  const ready = await evaluate(session, `(() => new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const edit = document.body.innerText.includes('编辑任务') || document.body.innerText.includes('此文件为 v2')
      if (edit || Date.now() - started > 8000) resolve({ edit, text: document.body.innerText.slice(0, 400) })
      else setTimeout(tick, 150)
    }
    tick()
  }))()`)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /编排图/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(500)
  const yamlTab = await evaluate(session, `(() => new Promise((resolve) => {
    const started = Date.now()
    const clickYaml = () => {
      const button = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === 'YAML')
      button?.click()
    }
    clickYaml()
    const tick = () => {
      const area = document.querySelector('textarea[aria-label="YAML"]')
      if (area || Date.now() - started > 8000) resolve({ ok: Boolean(area), elapsed: Date.now() - started })
      else {
        if (Date.now() - started > 400) clickYaml()
        setTimeout(tick, 150)
      }
    }
    tick()
  }))()`)

  const edited = await evaluate(session, `(() => {
    const area = document.querySelector('textarea[aria-label="YAML"]')
    if (!area) return { ok: false }
    const next = ${JSON.stringify(V3)}
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, next)
    area.dispatchEvent(new Event('input', { bubbles: true }))
    area.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, length: area.value.length }
  })()`)
  await sleep(300)

  const saveClicked = await evaluate(session, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '保存')
    button?.click()
    return Boolean(button)
  })()`)
  await sleep(700)
  const dialogAfterSave = await evaluate(session, `({
    title: document.body.innerText.includes('确认保存为 v3'),
    confirm: [...document.querySelectorAll('button')].some((button) => /保存为 v3/.test(button.textContent || '')),
    yamlValue: document.querySelector('textarea[aria-label="YAML"]')?.value?.slice(0, 80) ?? null,
    page: document.body.innerText.slice(0, 900),
  })`)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '取消') || {}).click?.()`)
  await sleep(400)
  const afterCancel = {
    yaml: readFileSync(TASK, 'utf8'),
    unchanged: readFileSync(TASK, 'utf8') === readFileSync(ORIG, 'utf8'),
    history: existsSync(HISTORY) ? readdirSync(HISTORY) : [],
  }

  await evaluate(session, `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '保存') || {}).click?.()`)
  await sleep(700)
  const confirmed = await evaluate(session, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => /保存为 v3/.test(item.textContent || ''))
    button?.click()
    return Boolean(button)
  })()`)
  await sleep(1800)
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))

  const saved = existsSync(TASK) ? readFileSync(TASK, 'utf8') : ''
  const report = {
    ready,
    yamlTab,
    switched,
    edited,
    saveClicked,
    dialogAfterSave,
    afterCancel,
    confirmed,
    afterConfirm: {
      yaml: saved,
      isV3: /^schema_version:\s*3\b/m.test(saved),
      history: existsSync(HISTORY) ? readdirSync(HISTORY) : [],
    },
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  session.close()
  if (!dialogAfterSave.title || !afterCancel.unchanged || !report.afterConfirm.isV3 || report.afterConfirm.history.length === 0) {
    process.exitCode = 1
  }
}

await main()
