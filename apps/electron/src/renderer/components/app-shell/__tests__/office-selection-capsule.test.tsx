import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { OfficePreviewFrame } from '../OfficePreviewFrame'
import { OfficeSelectionCapsule } from '../OfficeSelectionCapsule'
import { decideOfficeSelection, type OfficeSelectionEcho } from '@/lib/office-selection'

const i18n = i18next.createInstance()
const active = { previewId: 'preview-1', isDraft: false, resuming: false, refreshing: false, activePreviewId: 'preview-1' }

beforeAll(async () => {
  await i18n.init({
    lng: 'zh-Hans',
    fallbackLng: 'zh-Hans',
    resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } },
    interpolation: { escapeValue: false },
  })
})

function Providers({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

function textOf(renderer: ReactTestRenderer): string {
  const parts: string[] = []
  const walk = (value: unknown) => {
    if (!value) return
    if (typeof value === 'string') parts.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (typeof value === 'object' && 'children' in value) walk((value as { children: unknown }).children)
  }
  walk(renderer.toJSON())
  return parts.join('')
}

function classesOf(renderer: ReactTestRenderer, testId: string): string[] {
  return String(renderer.root.findByProps({ 'data-testid': testId }).props.className).split(/\s+/)
}

describe('office selection capsule', () => {
  test('paints the count above the preview document and updates it when the selection changes', () => {
    let count = 0
    let echo: OfficeSelectionEcho | undefined
    const receive = (paths: unknown, extra: Partial<Parameters<typeof decideOfficeSelection>[0]> = {}) => {
      const decision = decideOfficeSelection({ ...active, paths, echo, ...extra })
      if (decision.type === 'echo') {
        echo = undefined
        return decision
      }
      if (decision.type === 'ignore') return decision
      count = decision.count
      return decision
    }

    expect(receive(['/slide[2]/shape[1]'])).toEqual({ type: 'apply', count: 1, paths: ['/slide[2]/shape[1]'] })
    expect(receive(['/slide[2]/shape[1]', '/slide[2]/shape[4]', '/slide[2]/shape[9]'])).toMatchObject({ type: 'apply', count: 3 })
    let renderer: ReactTestRenderer
    act(() => { renderer = create(<Providers><OfficeSelectionCapsule count={count} /></Providers>) })
    expect(textOf(renderer!)).toContain('已选 3 / 256')
    expect(renderer!.root.findByProps({ 'data-testid': 'office-selection-capsule' }).props['aria-label']).toBe('已选择 3 个元素，最多 256 个')
    expect(classesOf(renderer!, 'office-selection-capsule')).toContain('z-[3]')
    expect(String(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('rounded-full'))[0]?.props.className)).toContain('text-accent')

    expect(receive([])).toEqual({ type: 'apply', count: 0, paths: [] })
    act(() => { renderer!.update(<Providers><OfficeSelectionCapsule count={count} /></Providers>) })
    expect(textOf(renderer!)).toContain('已选 0 / 256')
    expect(String(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('rounded-full'))[0]?.props.className)).toContain('text-foreground')
    expect(renderer!.root.findByProps({ 'data-office-selection-count': 0 })).toBeTruthy()

    const paths = Array.from({ length: 256 }, (_, index) => `/cell/${index}`)
    expect(receive(paths).type).toBe('apply')
    act(() => { renderer!.update(<Providers><OfficeSelectionCapsule count={count} /></Providers>) })
    expect(textOf(renderer!)).toContain('已选 256 / 256')
    expect(String(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('rounded-full'))[0]?.props.className)).not.toContain('text-destructive')

    const overflow = receive([...paths, '/cell/256'])
    expect(overflow).toEqual({ type: 'overflow', count: 257 })
    expect(overflow).not.toHaveProperty('paths')
    act(() => { renderer!.update(<Providers><OfficeSelectionCapsule count={count} /></Providers>) })
    expect(textOf(renderer!)).toContain('已选 257 / 256')
    expect(String(renderer!.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('rounded-full'))[0]?.props.className)).toContain('text-destructive')
    act(() => { renderer!.unmount() })
  })

  test('ignores echoes, drafts, and gestures that are not the active preview', () => {
    const echo = { previewId: 'preview-1', paths: ['/body/1', '/body/2'] }
    expect(decideOfficeSelection({ ...active, paths: ['/body/2', '/body/1'], echo })).toEqual({ type: 'echo' })
    expect(decideOfficeSelection({ ...active, paths: ['/body/1'], echo }).type).toBe('apply')
    expect(decideOfficeSelection({ ...active, paths: 'not-a-list' })).toEqual({ type: 'ignore' })
    expect(decideOfficeSelection({ ...active, paths: ['/ok', 2] })).toEqual({ type: 'ignore' })
    expect(decideOfficeSelection({ ...active, paths: ['/body/1'], isDraft: true })).toEqual({ type: 'ignore' })
    expect(decideOfficeSelection({ ...active, paths: ['/body/1'], resuming: true })).toEqual({ type: 'ignore' })
    expect(decideOfficeSelection({ ...active, paths: ['/body/1'], refreshing: true })).toEqual({ type: 'ignore' })
    expect(decideOfficeSelection({ ...active, paths: ['/body/1'], activePreviewId: 'other' })).toEqual({ type: 'ignore' })
  })

  test('keeps the capsule outside the document layer for Word, Excel, and PowerPoint', () => {
    const html = renderToStaticMarkup(<Providers>
      <div id="stage">
        <OfficePreviewFrame title="Office" sandbox="allow-scripts" srcDoc="<p>slide</p>" />
        <OfficeSelectionCapsule count={2} />
      </div>
    </Providers>)
    const viewportAt = html.indexOf('data-office-preview-viewport')
    const viewport = html.slice(html.lastIndexOf('<div', viewportAt), html.indexOf('>', viewportAt) + 1)
    const capsule = html.match(/<div[^>]*data-testid="office-selection-capsule"[^>]*>/)?.[0] ?? ''
    expect(viewport).toContain('isolate')
    expect(viewport).toContain('z-0')
    expect(viewport).toContain('peer/office-viewport')
    expect(capsule).toContain('z-[3]')
    expect(capsule).toContain('peer-data-[office-resizing=true]/office-viewport:hidden')
    expect(html).toContain('absolute left-0 top-0 z-[1]')
    expect(html.indexOf('data-office-preview-viewport')).toBeLessThan(html.indexOf('data-testid="office-selection-capsule"'))
    expect(html).toContain('已选 2 / 256')
    const hook = readFileSync(new URL('../../../hooks/useOfficePreview.tsx', import.meta.url), 'utf8')
    expect(hook).toContain('decideOfficeSelection(')
    expect(hook).toContain('{target.preview && !target.preview.readOnly && <OfficeSelectionCapsule count={target.count} busy={!!target.busy} />}')
    expect(hook).toContain('paths: decision.paths')
    expect(hook).toContain("decision.type === 'overflow'")
  })
})

function chromeBinary(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/local/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((value): value is string => !!value)
  return candidates.find(path => existsSync(path))
}

const STACK_CSS = `
  html, body { margin: 0; }
  #stage { position: relative; width: 640px; height: 480px; }
  #stage > [data-office-preview-viewport] { width: 100%; height: 100%; }
  .relative { position: relative; }
  .absolute { position: absolute; }
  .isolate { isolation: isolate; }
  .z-0 { z-index: 0; }
  .left-0 { left: 0; } .top-0 { top: 0; }
  .h-full { height: 100%; } .w-full { width: 100%; }
  .overflow-hidden { overflow: hidden; }
  .inset-0 { inset: 0; }
  .inset-x-3 { left: 0.75rem; right: 0.75rem; }
  .bottom-8 { bottom: 2rem; }
  .z-\\[1\\] { z-index: 1; }
  .z-\\[2\\] { z-index: 2; }
  .z-\\[3\\] { z-index: 3; }
  .flex { display: flex; }
  .justify-center { justify-content: center; }
  .pointer-events-none { pointer-events: none; }
  .hidden { display: none; }
  .peer\\/office-viewport[data-office-resizing="true"] ~ .peer-data-\\[office-resizing\\=true\\]\\/office-viewport\\:hidden { display: none; }
`

test.skipIf(!chromeBinary())('the selection capsule is the top hit over a PowerPoint preview and hides while resizing', async () => {
  const markup = renderToStaticMarkup(<Providers>
    <div id="stage">
      <OfficePreviewFrame title="Office" sandbox="allow-scripts" srcDoc="<p>slide</p>" />
      <OfficeSelectionCapsule count={2} />
    </div>
  </Providers>)
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>${STACK_CSS}</style></head><body>${markup}</body></html>`
  const server = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(page)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const debugPort = 20000 + Math.floor(Math.random() * 20000)
  const chrome = spawn(chromeBinary()!, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/selection-office-capsule-${debugPort}`,
    '--window-size=900,700',
    'about:blank',
  ], { stdio: 'ignore' })
  try {
    const hit = await probeCapsule(debugPort, port)
    expect(hit.overlaps).toBe(true)
    expect(hit.onCapsule).toBe(true)
    expect(hit.hiddenWhileResizing).toBe(true)
    expect(hit.shownAfter).toBe(true)
    expect(hit.text).toContain('已选 2 / 256')
    expect(hit.parent).toBe('stage')
    expect(hit.capZ).toBe('3')
    expect(hit.viewZ).toBe('0')
    expect(hit.frameZ).toBe('1')
  } finally {
    chrome.kill('SIGKILL')
    await new Promise(resolve => server.close(resolve))
  }
}, 30_000)

interface CapsuleHit {
  overlaps: boolean
  onCapsule: boolean
  hiddenWhileResizing: boolean
  shownAfter: boolean
  text: string
  parent: string | null
  capZ: string
  viewZ: string
  frameZ: string
}

async function probeCapsule(debugPort: number, port: number): Promise<CapsuleHit> {
  const deadline = Date.now() + 10_000
  let last = ''
  let socketUrl = ''
  while (Date.now() < deadline) {
    try {
      const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.json()) as { webSocketDebuggerUrl?: string }
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
      const page = targets.find(target => target.type === 'page')
      if (version.webSocketDebuggerUrl && page) { socketUrl = page.webSocketDebuggerUrl; break }
    } catch (error) { last = String(error) }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!socketUrl) throw new Error(last || 'Chrome did not open a debugging port')
  const socket = new WebSocket(socketUrl)
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
      const timer = setTimeout(() => reject(new Error('capsule page did not load')), 8_000)
      onLoad = () => { clearTimeout(timer); resolve() }
    })
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` })
    await loaded
    const message = await send('Runtime.evaluate', { expression: `(() => {
      const capsule = document.querySelector('[data-testid="office-selection-capsule"]');
      const viewport = document.querySelector('[data-office-preview-viewport]');
      const frame = viewport.querySelector('iframe');
      const cap = capsule.getBoundingClientRect();
      const box = viewport.getBoundingClientRect();
      const overlaps = cap.width > 0 && cap.height > 0 && cap.top < box.bottom && cap.bottom > box.top && cap.left < box.right && cap.right > box.left;
      capsule.style.pointerEvents = 'auto';
      const hit = document.elementFromPoint(cap.left + cap.width / 2, cap.top + cap.height / 2);
      const onCapsule = !!(hit && hit.closest && hit.closest('[data-testid="office-selection-capsule"]'));
      capsule.style.pointerEvents = '';
      viewport.dataset.officeResizing = 'true';
      const hiddenWhileResizing = getComputedStyle(capsule).display === 'none';
      delete viewport.dataset.officeResizing;
      const shownAfter = getComputedStyle(capsule).display !== 'none';
      return { overlaps, onCapsule, hiddenWhileResizing, shownAfter, text: capsule.textContent, parent: capsule.parentElement && capsule.parentElement.id, capZ: getComputedStyle(capsule).zIndex, viewZ: getComputedStyle(viewport).zIndex, frameZ: getComputedStyle(frame).zIndex };
    })()`, returnByValue: true, awaitPromise: true })
    if (message.error) throw new Error(JSON.stringify(message.error))
    if (message.result?.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails))
    return message.result?.result?.value as CapsuleHit
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

afterAll(() => { i18n.removeResourceBundle('zh-Hans', 'translation') })
