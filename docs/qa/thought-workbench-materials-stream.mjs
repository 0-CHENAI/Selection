import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9333'
const PDF = '/tmp/selection-thought-wb-qa-materials/large-material.pdf'
const TXT = '/tmp/selection-thought-wb-qa-materials/large-material.txt'
const SAMPLE = new URL('../../apps/electron/src/renderer/assets/samples/sample-invoice.pdf', import.meta.url).pathname
const OUT = new URL('./thought-workbench-materials-stream.json', import.meta.url)
const PNG = new URL('./thought-workbench-materials-stream.png', import.meta.url)

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

async function importFile(session, filePath, namePattern) {
  const document = await session.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector: 'input[aria-label="添加材料"]',
  })
  if (!nodeId) throw new Error('material file input not found')
  const heapBefore = await session.send('Runtime.getHeapUsage')
  const started = Date.now()
  await session.send('DOM.setFileInputFiles', { nodeId, files: [filePath] })
  const imported = await evaluate(session, `(() => new Promise((resolve) => {
    const startedAt = Date.now()
    const tick = () => {
      const named = [...document.querySelectorAll('button, span, a')].some((el) => /${namePattern}/.test(el.textContent || ''))
      const failed = /导入失败/.test(document.body.innerText)
      if (named || failed || Date.now() - startedAt > 90000) resolve({
        ok: named && !failed,
        failed,
        elapsed: Date.now() - startedAt,
      })
      else setTimeout(tick, 150)
    }
    tick()
  }))()`)
  const heapAfter = await session.send('Runtime.getHeapUsage')
  return { imported, heapBefore, heapAfter, wallMs: Date.now() - started }
}

async function main() {
  const report = { startedAt: new Date().toISOString() }
  const write = () => writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  const targets = await fetch(`${CDP}/json/list`).then((response) => response.json())
  const page = targets.find((target) => target.type === 'page' && !/devtools/i.test(target.url))
  if (!page) throw new Error('No Electron renderer on 9333')
  const session = new CdpSession(new WebSocket(page.webSocketDebuggerUrl))
  await waitOpen(session.ws)
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  await session.send('DOM.enable')
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(2000)
  await evaluate(session, 'window.resizeTo(1280, 900)')
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /稍后设置/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(400)
  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1500)

  report.samplePdf = await importFile(session, SAMPLE, 'sample-invoice\\.pdf')
  await sleep(600)
  report.sampleReader = await evaluate(session, `(() => {
    const canvas = document.querySelector('[data-testid="thought-canvas-editor"] canvas, aside canvas, canvas')
    const box = canvas?.getBoundingClientRect()
    return {
      canvas: Boolean(canvas),
      width: canvas?.width ?? null,
      height: canvas?.height ?? null,
      css: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
      pages: [...document.querySelectorAll('select[aria-label="页"], select[aria-label="Page"] option')].map((option) => option.textContent || ''),
      textChars: (document.querySelector('textarea[aria-label="材料文本"]')?.value || '').length,
    }
  })()`)
  report.zoom150 = await evaluate(session, `(() => {
    const zoomIn = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === '放大' || (item.textContent || '').trim() === '+')
    zoomIn?.click()
    return Boolean(zoomIn)
  })()`)
  await sleep(800)
  report.sampleZoomed = await evaluate(session, `(() => {
    const canvas = document.querySelector('[data-testid="thought-canvas-editor"] canvas, aside canvas, canvas')
    return { width: canvas?.width ?? null, height: canvas?.height ?? null, label: [...document.querySelectorAll('button')].map((item) => (item.textContent || '').trim()).find((text) => /%/.test(text)) || null }
  })()`)

  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1400)
  report.largePdf = await importFile(session, PDF, 'large-material\\.pdf')
  await sleep(800)
  report.pdfPeak = await evaluate(session, `(() => new Promise((resolve) => {
    const samples = []
    const started = performance.now()
    const tick = (now) => {
      samples.push({
        t: Math.round(now - started),
        used: performance.memory?.usedJSHeapSize ?? null,
        total: performance.memory?.totalJSHeapSize ?? null,
      })
      if (now - started < 2500) requestAnimationFrame(tick)
      else {
        const used = samples.map((item) => item.used).filter((value) => value != null)
        resolve({
          samples: samples.length,
          usedMin: used.length ? Math.min(...used) : null,
          usedMax: used.length ? Math.max(...used) : null,
          usedLast: used.at(-1) ?? null,
          canvas: (() => {
            const canvas = document.querySelector('[data-testid="thought-canvas-editor"] canvas, aside canvas, canvas')
            return canvas ? { width: canvas.width, height: canvas.height } : null
          })(),
          pages: document.querySelectorAll('select[aria-label="页"] option, select[aria-label="Page"] option').length,
          textChars: (document.querySelector('textarea[aria-label="材料文本"]')?.value || '').length,
        })
      }
    }
    requestAnimationFrame(tick)
  }))()`)
  report.page2 = await evaluate(session, `(() => {
    const select = document.querySelector('select[aria-label="页"], select[aria-label="Page"]')
    if (!select || select.options.length < 2) return { ok: false }
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, select.options[1].value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: select.value }
  })()`)
  await sleep(700)

  await evaluate(session, `([...document.querySelectorAll('button')].find((button) => /新建编排/.test(button.textContent || '')) || {}).click?.()`)
  await sleep(1400)
  report.largeText = await importFile(session, TXT, 'large-material\\.txt')
  await sleep(600)
  report.textFrames = await evaluate(session, `(() => new Promise((resolve) => {
    const reader = document.querySelector('textarea[aria-label="材料文本"]')
    if (!reader) { resolve({ ok: false }); return }
    const deltas = []
    let last = performance.now()
    let frames = 0
    const maxTop = reader.scrollHeight
    const step = Math.max(40, Math.floor(maxTop / 45))
    const tick = (now) => {
      deltas.push(now - last)
      last = now
      reader.scrollTop = Math.min(maxTop, (frames + 1) * step)
      frames += 1
      if (frames < 45) requestAnimationFrame(tick)
      else {
        const sorted = [...deltas].sort((a, b) => a - b)
        resolve({
          ok: true,
          frames,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          max: sorted.at(-1),
          over33ms: deltas.filter((value) => value > 33).length,
          over16ms: deltas.filter((value) => value > 16.7).length,
          chars: reader.value.length,
          scrollHeight: reader.scrollHeight,
        })
      }
    }
    requestAnimationFrame(tick)
  }))()`)

  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(PNG, Buffer.from(shot.data, 'base64'))
  report.finishedAt = new Date().toISOString()
  write()
  console.log(JSON.stringify({
    sample: { ok: report.samplePdf?.imported?.ok, canvas: report.sampleReader, zoomed: report.sampleZoomed },
    largePdf: { ok: report.largePdf?.imported?.ok, elapsed: report.largePdf?.imported?.elapsed, peak: report.pdfPeak },
    text: { ok: report.largeText?.imported?.ok, frames: report.textFrames },
  }, null, 2))
  session.close()
}

await main()
