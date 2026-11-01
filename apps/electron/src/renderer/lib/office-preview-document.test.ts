import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { officePreviewDocument } from './office-preview-document'

/** The rule OfficeCLI 1.0.157 injects from watch-overlay.js after the preview bridge. */
const OFFICECLI_SELECTION_RULE = `:not(td):not(th).officecli-selected{outline:2px solid #2196f3 !important;outline-offset:2px;box-shadow:0 0 12px rgba(33,150,243,0.6) !important;z-index:1000;}`

const SLIDE_FIXTURE = `
<div class="sidebar">
  <div class="thumb"><div class="thumb-inner"></div></div>
  <div class="thumb"><div class="thumb-inner"></div></div>
</div>
<div class="main">
  <div class="slide-container" data-slide="1">
    <div class="slide" style="position:relative;width:960px;height:540px;overflow:hidden;background:#0B1F33">
      <div class="shape has-fill" data-path="/slide[1]/shape[@id=1]" style="position:absolute;left:0;top:0;width:960px;height:540px;background:#0B1F33"></div>
      <div class="shape" data-path="/slide[1]/shape[@id=2]" style="position:absolute;left:48px;top:180px;width:400px;height:70px;color:#fff;font-size:40px">forkreduce</div>
    </div>
  </div>
  <div class="slide-container" data-slide="2">
    <div class="slide" style="position:relative;width:960px;height:540px;overflow:hidden;background:#fff">
      <div class="shape has-fill" data-path="/slide[2]/shape[@id=3]" style="position:absolute;left:40px;top:80px;width:880px;height:400px;background:#fff"></div>
      <div class="shape" data-path="/slide[2]/shape[@id=4]" style="position:absolute;left:80px;top:140px;width:400px;height:48px;color:#111;font-size:28px">本次讲什么</div>
    </div>
  </div>
</div>
<script>
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(OFFICECLI_SELECTION_RULE)};
  document.head.appendChild(style);
  const slides = [...document.querySelectorAll('.main .slide')];
  const inners = [...document.querySelectorAll('.thumb-inner')];
  slides.forEach((slide, index) => {
    const clone = slide.cloneNode(true);
    clone.className = 'thumb-slide';
    inners[index].appendChild(clone);
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-path]');
    if (!target) return;
    document.querySelectorAll('.officecli-selected').forEach((el) => el.classList.remove('officecli-selected'));
    const path = target.getAttribute('data-path');
    document.querySelectorAll('[data-path]').forEach((el) => {
      if (el.getAttribute('data-path') === path) el.classList.add('officecli-selected');
    });
  }, true);
  const hit = (selector) => {
    const node = document.querySelector(selector);
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = node.getBoundingClientRect();
    const x = Math.min(innerWidth - 2, Math.max(1, rect.left + Math.min(rect.width / 2, 120)));
    const y = Math.min(innerHeight - 2, Math.max(1, rect.top + rect.height / 2));
    const at = document.elementFromPoint(x, y);
    return at && at.closest('[data-path]') ? at.closest('[data-path]').getAttribute('data-path') : null;
  };
  window.__clickShape = (path) => {
    const target = document.querySelector('.main [data-path="' + path + '"]');
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return {
      title: hit('.main [data-path="/slide[1]/shape[@id=2]"]'),
      thumb: hit('.thumb-slide [data-path="/slide[1]/shape[@id=2]"]'),
      heading: hit('.main [data-path="/slide[2]/shape[@id=4]"]'),
      thumbHeading: hit('.thumb-slide [data-path="/slide[2]/shape[@id=4]"]'),
      selectedZ: [...document.querySelectorAll('.officecli-selected')].map((el) => getComputedStyle(el).zIndex),
      text: document.body.innerText,
    };
  };
</script>`

function chromeBinary(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((value): value is string => !!value)
  return candidates.find(path => existsSync(path))
}

test('preview document keeps a selected slide shape from covering later siblings', () => {
  const html = officePreviewDocument('<div class="slide"></div>', 'preview')
  expect(html).toContain('selection-office-paste')
  expect(html).toContain('.slide .officecli-selected')
  expect(html).toContain('.thumb-slide .officecli-selected')
  expect(html).toContain('z-index: auto !important')
})

test.skipIf(!chromeBinary())('clicking a full-bleed slide shape leaves that page and its thumbnail painted', async () => {
  const html = officePreviewDocument(SLIDE_FIXTURE, 'preview-click')
  const server = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const debugPort = 9300 + Math.floor(Math.random() * 500)
  const chrome = spawn(chromeBinary()!, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/selection-ppt-click-${debugPort}`,
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' })
  try {
    await waitForChrome(debugPort)
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = targets.find(target => target.type === 'page')
    expect(page?.webSocketDebuggerUrl).toBeTruthy()
    const hits = await withPage(page!.webSocketDebuggerUrl, `http://127.0.0.1:${port}/`)
    expect(hits.dark.title).toBe('/slide[1]/shape[@id=2]')
    expect(hits.dark.thumb).toBe('/slide[1]/shape[@id=2]')
    expect(hits.dark.selectedZ).toEqual(['auto', 'auto'])
    expect(hits.dark.text).toContain('forkreduce')
    expect(hits.white.heading).toBe('/slide[2]/shape[@id=4]')
    expect(hits.white.thumbHeading).toBe('/slide[2]/shape[@id=4]')
    expect(hits.white.title).toBe('/slide[1]/shape[@id=2]')
    expect(hits.white.thumb).toBe('/slide[1]/shape[@id=2]')
    expect(hits.white.selectedZ).toEqual(['auto', 'auto'])
    expect(hits.white.text).toContain('本次讲什么')
  } finally {
    chrome.kill('SIGKILL')
    await new Promise(resolve => server.close(resolve))
  }
}, 30_000)

test.skipIf(!chromeBinary())('dropping or pasting a file on the Office preview forwards it to the parent', async () => {
  const html = officePreviewDocument('<div class="slide"></div>', 'preview-paste')
  const server = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const debugPort = 9800 + Math.floor(Math.random() * 500)
  const chrome = spawn(chromeBinary()!, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/selection-ppt-paste-${debugPort}`,
    '--window-size=800,600', 'about:blank',
  ], { stdio: 'ignore' })
  try {
    await waitForChrome(debugPort)
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = targets.find(target => target.type === 'page')
    expect(page?.webSocketDebuggerUrl).toBeTruthy()
    const forwarded = await forwardPreviewFile(page!.webSocketDebuggerUrl, `http://127.0.0.1:${port}/`)
    expect(forwarded).toEqual({ name: 'extra.png', type: 'image/png', bytes: 4 })
  } finally {
    chrome.kill('SIGKILL')
    await new Promise(resolve => server.close(resolve))
  }
}, 30_000)

async function forwardPreviewFile(webSocketUrl: string, url: string): Promise<{ name: string; type: string; bytes: number }> {
  const socket = new WebSocket(webSocketUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Chrome debugging socket failed')))
  })
  let id = 0
  const pending = new Map<number, (message: CdpMessage) => void>()
  let onLoad: (() => void) | undefined
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as CdpMessage
    if (message.id && pending.has(message.id)) pending.get(message.id)!(message)
    if (message.method === 'Page.loadEventFired') onLoad?.()
  })
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpMessage>((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, resolve)
    socket.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { if (pending.delete(msgId)) reject(new Error(`${method} timed out`)) }, 8_000)
  })
  try {
    await send('Page.enable')
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview page did not load')), 8_000)
      onLoad = () => { clearTimeout(timer); resolve() }
    })
    await send('Page.navigate', { url })
    await loaded
    const message = await send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ name: '', type: '', bytes: -1 }), 3000)
        window.addEventListener('message', (event) => {
          if (!event.data || event.data.type !== 'selection-office-paste') return
          clearTimeout(timer)
          const file = (event.data.files || [])[0] || {}
          resolve({ name: file.name || '', type: file.type || '', bytes: file.buffer ? file.buffer.byteLength : 0 })
        })
        const file = new File([new Uint8Array([1, 2, 3, 4])], 'extra.png', { type: 'image/png' })
        const data = new DataTransfer()
        data.items.add(file)
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
      })`,
      returnByValue: true,
      awaitPromise: true,
    })
    if (message.result?.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails))
    return message.result?.result?.value as { name: string; type: string; bytes: number }
  } finally {
    socket.close()
  }
}

interface Hit {
  title: string | null
  thumb: string | null
  heading: string | null
  thumbHeading: string | null
  selectedZ: string[]
  text: string
}

async function waitForChrome(port: number): Promise<void> {
  const deadline = Date.now() + 10_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json()) as { Browser?: string }
      if (version.Browser) return
    } catch (error) {
      last = String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(last || 'Chrome did not open a debugging port')
}

async function withPage(webSocketUrl: string, url: string): Promise<{ dark: Hit; white: Hit }> {
  const socket = new WebSocket(webSocketUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Chrome debugging socket failed')))
  })
  let id = 0
  const pending = new Map<number, (message: CdpMessage) => void>()
  let onLoad: (() => void) | undefined
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as CdpMessage
    if (message.id && pending.has(message.id)) pending.get(message.id)!(message)
    if (message.method === 'Page.loadEventFired') onLoad?.()
  })
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpMessage>((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, resolve)
    socket.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { if (pending.delete(msgId)) reject(new Error(`${method} timed out`)) }, 8_000)
  })
  const evaluate = async (expression: string) => {
    const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (message.error) throw new Error(JSON.stringify(message.error))
    if (message.result?.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails))
    return message.result?.result?.value
  }
  try {
    await send('Page.enable')
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview page did not load')), 8_000)
      onLoad = () => { clearTimeout(timer); resolve() }
    })
    await send('Page.navigate', { url })
    await loaded
    const ready = await evaluate(`typeof window.__clickShape === 'function'`)
    if (ready !== true) throw new Error('slide click harness was not installed')
    const dark = await evaluate(`window.__clickShape('/slide[1]/shape[@id=1]')`) as Hit
    const white = await evaluate(`window.__clickShape('/slide[2]/shape[@id=3]')`) as Hit
    return { dark, white }
  } finally {
    socket.close()
  }
}

interface CdpMessage {
  id?: number
  method?: string
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown }
  error?: unknown
}

test('preview document snaps Excel floating charts to their anchor row and column', () => {
  const html = officePreviewDocument('<html><head></head><body><div class="sheet-content active" data-sheet="0"></div></body></html>', 'p1')
  expect(html).toContain("'.sheet-content.active [data-from-row]'")
  expect(html).toContain("el.getAttribute('data-from-col')")
  expect(html).toContain('window.switchSheet = (index) => { switchSheet(index); anchorFloats(); }')
})
