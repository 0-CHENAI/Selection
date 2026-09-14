import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CDP = 'http://127.0.0.1:9333'
const ROOT = '/tmp/selection-thought-wb-qa/workspaces/my-workspace'
const TASKS = join(ROOT, 'tasks')
const OUT = new URL('./thought-workbench-real-model.json', import.meta.url)
const PNG_Q = new URL('./thought-workbench-real-model-query.png', import.meta.url)
const PNG_P = new URL('./thought-workbench-real-model-proposal.png', import.meta.url)
const PNG_R = new URL('./thought-workbench-real-model-run.png', import.meta.url)
const PNG_A = new URL('./thought-workbench-real-model-agent.png', import.meta.url)

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
function clickText(session, pattern, exact = false) {
  const source = exact
    ? `([...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === ${JSON.stringify(pattern)}) || {}).click?.()`
    : `([...document.querySelectorAll('button')].find((item) => /${pattern}/.test(item.textContent || '')) || {}).click?.()`
  return evaluate(session, source)
}
function snapshotTasks() {
  if (!existsSync(TASKS)) return []
  return readdirSync(TASKS).flatMap((slug) => {
    const dir = join(TASKS, slug)
    if (!statSync(dir).isDirectory()) return []
    const runs = existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith('run-')) : []
    return [{ slug, files: readdirSync(dir), runs }]
  })
}
function writeReport(report) {
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
}
async function shot(session, dest) {
  const image = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(dest, Buffer.from(image.data, 'base64'))
}

async function openNewBoard(session) {
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2200)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(600)
  await clickText(session, '新建编排')
  await sleep(1600)
}

async function waitFor(session, expression, timeoutMs) {
  return evaluate(session, `(() => new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const value = (${expression})
      if (value || Date.now() - started > ${timeoutMs}) resolve(value)
      else setTimeout(tick, 200)
    }
    tick()
  }))()`)
}

async function pageState(session) {
  return evaluate(session, `({
    text: document.body.innerText.slice(0, 1800),
    models: [...document.querySelectorAll('option')].map((option) => option.textContent || '').filter((text) => /Laufry|Opus|grok|ORDER|Fable/i.test(text)),
    connections: [...document.querySelectorAll('optgroup')].map((group) => group.label),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent || ''),
    status: [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent || ''),
  })`)
}

async function main() {
  mkdirSync(new URL('.', OUT).pathname, { recursive: true })
  const report = { startedAt: new Date().toISOString(), phases: {} }
  writeReport(report)
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  if (!page) throw new Error('No isolated Electron renderer on CDP 9333')
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await openNewBoard(session)
  await clickText(session, '问答', true)
  await sleep(800)

  report.phases.models = await pageState(session)
  report.phases.models.hasLaufry = (report.phases.models.models || []).some((text) => /Laufry/.test(text))
  report.phases.models.hasFable5 = (report.phases.models.models || []).some((text) => /Fable5/i.test(text))
  writeReport(report)
  if (!report.phases.models.hasLaufry) {
    report.error = 'Isolated app has no Laufry model after credential copy; refusing to treat this as a real-model run.'
    writeReport(report)
    session.close()
    process.exitCode = 1
    return
  }
  const filled = await evaluate(session, `(() => {
    const title = document.querySelector('input[aria-label="标题"]')
    const question = document.querySelector('textarea[aria-label="问答"]')
    const model = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Laufry/.test(option.textContent || '')))
    if (title) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'Real model QA')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (question) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(question, '用一句话回答：2+2等于几？不要调用工具，不要编造多余步骤。')
      question.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (model) {
      const option = [...model.options].find((item) => /Laufry/.test(item.textContent || ''))
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(model, option.value)
      model.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return { title: Boolean(title), question: Boolean(question), model: Boolean(model), modelValue: model?.value || null }
  })()`)
  report.phases.filled = filled
  writeReport(report)
  await clickText(session, '上下文预览')
  const previewReady = await waitFor(session, `document.body.innerText.includes('[sha256]') || document.body.innerText.includes('[model]') || [...document.querySelectorAll('[role="alert"]')].length > 0`, 45000)
  report.phases.queryPreview = {
    ready: Boolean(previewReady),
    ...(await pageState(session)),
  }
  writeReport(report)
  await clickText(session, '生成', true)
  const queryDone = await waitFor(session, `!!document.querySelector('.border-t') && document.body.innerText.includes('2') && !document.body.innerText.includes('正在生成')`, 180000)
  await shot(session, PNG_Q)
  report.phases.query = {
    done: Boolean(queryDone),
    ...(await pageState(session)),
  }
  writeReport(report)

  await clickText(session, '编排图')
  await sleep(500)
  await evaluate(session, `(() => {
    const summary = [...document.querySelectorAll('summary')].find((el) => /AI 辅助编排/.test(el.textContent || ''))
    const details = summary?.closest('details')
    if (details) details.open = true
    const area = document.querySelector('textarea[aria-label="目标或修改意见"]')
    return Boolean(area)
  })()`)

  const goals = [
    '创建一个 schema_version 3 任务，id 必须是 real-model-qa。只要一个 session 节点，id 为 ask，prompt 为：用一句话回答 2+2 等于几。不要加其他节点或工具。',
    '只把节点 ask 的 title 改成 Arithmetic，不要改 id、prompt 和其他字段。',
    '只增加 acceptance_criteria: 输出必须包含数字 4。不要改节点结构。',
  ]
  const proposals = []
  const tasksBeforeProposals = snapshotTasks()
  for (const [index, goal] of goals.entries()) {
    await evaluate(session, `(() => {
      const summary = [...document.querySelectorAll('summary')].find((el) => /AI 辅助编排/.test(el.textContent || ''))
      const details = summary?.closest('details')
      if (details) details.open = true
      const area = document.querySelector('textarea[aria-label="目标或修改意见"]')
      if (!area) return false
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, ${JSON.stringify(goal)})
      area.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await clickText(session, '生成提案')
    const finished = await waitFor(session, `document.body.innerText.includes('检查节点与依赖') || document.body.innerText.includes('提案生成失败') || document.body.innerText.includes('提案超时')`, 200000)
    const state = await pageState(session)
    const applied = /检查节点与依赖/.test(state.text)
      ? await evaluate(session, `(() => {
          const button = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '应用到草稿')
          const disabled = Boolean(button?.disabled)
          button?.click()
          return { clicked: Boolean(button), disabled }
        })()`)
      : { clicked: false }
    await sleep(800)
    proposals.push({
      round: index + 1,
      goal,
      finished: Boolean(finished),
      applied,
      alerts: state.alerts,
      review: /检查节点与依赖/.test(state.text),
      stale: /生成期间草稿已修改/.test(state.text),
      failed: /提案生成失败|提案超时/.test(state.text),
      text: state.text.slice(0, 900),
    })
    report.phases.proposals = { rounds: proposals, tasks: snapshotTasks(), tasksBefore: tasksBeforeProposals }
    writeReport(report)
    if (!applied.clicked) break
  }
  await shot(session, PNG_P)

  const stale = await evaluate(session, `(() => {
    const title = document.querySelector('input[aria-label="标题"]')
    if (title) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'manual-edit-stale')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const apply = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '应用到草稿')
    apply?.click()
    return { edited: Boolean(title), applyVisible: Boolean(apply) }
  })()`)
  await sleep(400)
  report.phases.stale = { ...stale, ...(await pageState(session)) }
  writeReport(report)

  await evaluate(session, `(() => {
    const area = document.querySelector('textarea[aria-label="目标或修改意见"]')
    if (!area) return false
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, '在上一版草稿上只把 goal 改成：confirm arithmetic after a manual title edit。不要改节点。')
    area.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await clickText(session, '生成提案')
  const reproposed = await waitFor(session, `document.body.innerText.includes('检查节点与依赖') || document.body.innerText.includes('提案生成失败') || document.body.innerText.includes('提案超时')`, 200000)
  if (reproposed) await clickText(session, '应用到草稿')
  await sleep(800)
  const tasksAfterApply = snapshotTasks()
  report.phases.repropose = {
    finished: Boolean(reproposed),
    tasksAfterApply,
    applyCreatedTask: tasksAfterApply.some((item) => item.slug === 'real-model-qa'),
    ...(await pageState(session)),
  }
  writeReport(report)

  await clickText(session, '保存', true)
  await sleep(2000)
  const afterSave = {
    tasks: snapshotTasks(),
    ...(await pageState(session)),
  }
  report.phases.save = afterSave
  writeReport(report)

  await openNewBoard(session)
  await evaluate(session, `(() => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Real model|real-model|manual-edit/.test(option.textContent || '')))
    if (!select) return { ok: false, options: [...document.querySelectorAll('select option')].map((option) => option.textContent || '') }
    const option = [...select.options].find((item) => /Real model|real-model|manual-edit/.test(item.textContent || ''))
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: option.value, label: option.textContent }
  })()`)
  await sleep(1600)
  await clickText(session, '保存并运行')
  await clickText(session, '创建并运行')
  const runStarted = await waitFor(session, `document.body.innerText.includes('运行定义已冻结') || document.body.innerText.includes('结果') || document.body.innerText.includes('等待审批')`, 30000)
  await sleep(1500)
  await openNewBoard(session)
  await evaluate(session, `(() => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Real model|real-model|manual-edit/.test(option.textContent || '')))
    if (!select) return false
    const option = [...select.options].find((item) => /Real model|real-model|manual-edit/.test(item.textContent || ''))
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(1600)
  await clickText(session, '结果')
  const resultsReady = await waitFor(session, `document.body.innerText.includes('添加到思考视图') || document.body.innerText.includes('暂无') || document.body.innerText.includes('失败')`, 180000)
  await clickText(session, '添加到思考视图')
  await sleep(1200)
  await shot(session, PNG_R)
  const imported = await pageState(session)
  report.phases.run = {
    runStarted: Boolean(runStarted),
    resultsReady: Boolean(resultsReady),
    tasks: snapshotTasks(),
    importedText: imported.text,
    alerts: imported.alerts,
  }
  writeReport(report)

  await clickText(session, '思考')
  await sleep(400)
  await clickText(session, '问答', true)
  await evaluate(session, `(() => {
    const question = document.querySelector('textarea[aria-label="问答"]')
    const mode = document.querySelector('select[aria-label="模式"]') || [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'agent'))
    if (question) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(question, '请使用工具列出当前工作区根目录的文件名，只返回文件名。不要修改任何文件。')
      question.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (mode) {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(mode, 'agent')
      mode.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return { question: Boolean(question), mode: Boolean(mode) }
  })()`)
  await clickText(session, '上下文预览')
  const agentPreview = await waitFor(session, `document.body.innerText.includes('[tools]') || [...document.querySelectorAll('[role="alert"]')].length > 0`, 45000)
  const previewState = await pageState(session)
  report.phases.agentPreview = { ready: Boolean(agentPreview), tools: /\[tools\]/.test(previewState.text), text: previewState.text.slice(0, 1200) }
  writeReport(report)
  await clickText(session, '生成', true)
  const permission = await waitFor(session, `document.body.innerText.includes('需要权限') || document.body.innerText.includes('打开会话') || document.body.innerText.includes('失败')`, 180000)
  if (/打开会话/.test((await pageState(session)).text)) await clickText(session, '打开会话')
  await sleep(1200)
  const permissionState = await pageState(session)
  const denied = /需要权限/.test(permissionState.text)
    ? await evaluate(session, `(() => {
        const deny = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '不允许')
        deny?.click()
        return Boolean(deny)
      })()`)
    : false
  await sleep(800)
  await clickText(session, '取消', true)
  await sleep(600)
  report.phases.agentDeny = { permission: Boolean(permission), denied, ...(await pageState(session)) }
  writeReport(report)

  await openNewBoard(session)
  await evaluate(session, `(() => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => /Real model|real-model|manual-edit/.test(option.textContent || '')))
    if (!select) return false
    const option = [...select.options].find((item) => /Real model|real-model|manual-edit/.test(item.textContent || ''))
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(1600)
  const recovered = await pageState(session)
  report.phases.agentRecover = {
    autoReranTools: /需要权限/.test(recovered.text) && !/生成/.test(recovered.text),
    text: recovered.text.slice(0, 900),
  }
  await clickText(session, '问答', true)
  await evaluate(session, `(() => {
    const question = document.querySelector('textarea[aria-label="问答"]')
    const mode = [...document.querySelectorAll('select')].find((el) => [...el.options].some((option) => option.value === 'agent'))
    if (question) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(question, '请使用工具列出当前工作区根目录的文件名，只返回文件名。不要修改任何文件。')
      question.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (mode) {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(mode, 'agent')
      mode.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return true
  })()`)
  await clickText(session, '上下文预览')
  await waitFor(session, `document.body.innerText.includes('[tools]') || [...document.querySelectorAll('[role="alert"]')].length > 0`, 45000)
  await clickText(session, '生成', true)
  await waitFor(session, `document.body.innerText.includes('需要权限') || document.body.innerText.includes('打开会话') || document.body.innerText.includes('失败')`, 180000)
  if (/打开会话/.test((await pageState(session)).text)) await clickText(session, '打开会话')
  await sleep(1000)
  const allowed = await evaluate(session, `(() => {
    const allow = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '允许')
    allow?.click()
    return Boolean(allow)
  })()`)
  const agentDone = await waitFor(session, `document.body.innerText.includes('config.json') || document.body.innerText.includes('tasks') || document.body.innerText.includes('失败')`, 180000)
  await shot(session, PNG_A)
  report.phases.agentAllow = { allowed, done: Boolean(agentDone), ...(await pageState(session)) }
  report.finishedAt = new Date().toISOString()
  report.tasksFinal = snapshotTasks()
  writeReport(report)
  console.log(JSON.stringify({
    models: report.phases.models.hasLaufry,
    query: report.phases.query?.done,
    proposals: report.phases.proposals?.rounds?.map((item) => ({ round: item.round, review: item.review, failed: item.failed })),
    save: report.phases.save?.tasks?.map((item) => item.slug),
    run: report.phases.run?.tasks,
    agent: { denied: report.phases.agentDeny?.denied, allowed },
  }, null, 2))
  session.close()
}

await main()
