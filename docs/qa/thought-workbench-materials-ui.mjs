import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CDP = 'http://127.0.0.1:9333'
const FILE = '/tmp/selection-thought-wb-qa-materials/large-material.txt'
const OUT = new URL('./thought-workbench-materials-ui.json', import.meta.url)
const PNG = new URL('./thought-workbench-materials-ui.png', import.meta.url)

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
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await session.send('DOM.enable')
  await session.send('HeapProfiler.enable')
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2200)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(500)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1600)

  const before = await session.send('Runtime.getHeapUsage')
  const started = Date.now()
  const document = await session.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector: 'input[aria-label="添加材料"]',
  })
  if (!nodeId) throw new Error('material file input not found')
  await session.send('DOM.setFileInputFiles', { nodeId, files: [FILE] })
  const imported = await evaluate(session, `(() => new Promise((resolve) => {
    const startedAt = Date.now()
    const tick = () => {
      const named = [...document.querySelectorAll('button')].some((button) => /large-material\\.txt/.test(button.textContent || ''))
      const failed = /导入失败/.test(document.body.innerText)
      if (named || failed || Date.now() - startedAt > 60000) resolve({
        ok: named && !failed,
        failed,
        elapsed: Date.now() - startedAt,
        text: document.body.innerText.slice(0, 400),
      })
      else setTimeout(tick, 150)
    }
    tick()
  }))()`)
  const after = await session.send('Runtime.getHeapUsage')
  const memory = await evaluate(session, `({
    jsHeap: performance.memory ? {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit,
    } : null,
    nodes: document.querySelectorAll('*').length,
  })`)
  const readerReady = await evaluate(session, `(() => new Promise((resolve) => {
    const startedAt = Date.now()
    const tick = () => {
      const reader = document.querySelector('textarea[aria-label="材料文本"], textarea[aria-label="Material text"]')
      if (reader || Date.now() - startedAt > 15000) resolve({ ok: Boolean(reader), elapsed: Date.now() - startedAt })
      else setTimeout(tick, 150)
    }
    tick()
  }))()`)
  const scroll = await evaluate(session, `(() => {
    const reader = document.querySelector('textarea[aria-label="材料文本"], textarea[aria-label="Material text"]')
    const aside = document.querySelector('[data-testid="thought-canvas-editor"]')
    const frames = []
    const beforeTop = reader?.scrollTop ?? 0
    const t0 = performance.now()
    if (reader) {
      reader.scrollTop = Math.min(400, reader.scrollHeight)
      frames.push({ at: performance.now() - t0, top: reader.scrollTop })
      reader.scrollTop = reader.scrollHeight
      frames.push({ at: performance.now() - t0, top: reader.scrollTop })
    }
    return {
      openedReader: Boolean(reader),
      readerChars: reader?.value?.length ?? 0,
      beforeTop,
      afterTop: reader?.scrollTop ?? 0,
      scrolled: (reader?.scrollTop ?? 0) > beforeTop,
      asideHeight: aside?.scrollHeight ?? null,
      frames,
    }
  })()`)
  const disk = (() => {
    const root = '/tmp/selection-thought-wb-qa/workspaces/my-workspace/thought-workbenches'
    const latest = readdirSync(root)
      .map((name) => ({ name, dir: join(root, name) }))
      .filter((item) => existsSync(join(item.dir, 'document.json')))
      .map((item) => {
        const blobs = readdirSync(item.dir).filter((name) => name.startsWith('blob-'))
        return {
          id: item.name,
          documentBytes: statSync(join(item.dir, 'document.json')).size,
          blobs: blobs.map((name) => ({ name, bytes: statSync(join(item.dir, name)).size })),
          mtime: statSync(join(item.dir, 'document.json')).mtimeMs,
        }
      })
      .sort((a, b) => b.mtime - a.mtime)[0]
    return latest
  })()
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))
  const report = {
    file: FILE,
    importMs: Date.now() - started,
    imported,
    readerReady,
    disk,
    heapBefore: before,
    heapAfter: after,
    heapDeltaBytes: (after.usedSize ?? 0) - (before.usedSize ?? 0),
    memory,
    scroll,
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  session.close()
  if (!imported.ok) process.exitCode = 1
}

await main()
