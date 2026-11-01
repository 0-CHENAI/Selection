/**
 * 用 office_render 的页图管道（OfficeCLI HTML + 页脚本 + 截图）生成案例封面。
 * 宿主在这里是本机 Chrome 的离屏截图，桌面版用的是同一套脚本和 Electron capturePage。
 *
 * OFFICECLI=/path/to/officecli bun scripts/render-personal-office-covers.ts
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
  OFFICE_PAGE_RENDER_STEP,
  officePageScript,
  renderOfficePages,
  type OfficePageCaptureHost,
  type OfficePageCaptureInput,
  type OfficePageCaptureResult,
} from '@craft-agent/server-core/services'

const officecli = process.env.OFFICECLI ?? '/tmp/officecli-bin/officecli'
const cases = join(import.meta.dir, '../apps/electron/resources/skills/office-business/cases')
const covers = join(import.meta.dir, '../apps/electron/src/renderer/assets/office-covers')
const previewDir = process.env.COVER_PREVIEW_DIR ?? '/tmp/personal-office-pages'

const files: Array<{ id: string; file: string; kind: 'docx' | 'xlsx'; range?: string }> = [
  { id: 'house-lease', file: 'house-lease/example.docx', kind: 'docx' },
  { id: 'product-resume', file: 'product-resume/example.docx', kind: 'docx' },
  { id: 'travel-claim', file: 'travel-claim/example.docx', kind: 'docx' },
  { id: 'annual-invitation', file: 'annual-invitation/example.docx', kind: 'docx' },
  { id: 'miniapp-prd', file: 'miniapp-prd/example.docx', kind: 'docx' },
  { id: 'partnership-letter', file: 'partnership-letter/example.docx', kind: 'docx' },
  { id: 'equipment-quote', file: 'equipment-quote/example.xlsx', kind: 'xlsx', range: 'A1:G16' },
  { id: 'household-budget', file: 'household-budget/example.xlsx', kind: 'xlsx', range: 'A1:E18' },
  { id: 'vendor-statement', file: 'vendor-statement/example.xlsx', kind: 'xlsx', range: 'A1:G10' },
  { id: 'project-gantt', file: 'project-gantt/example.xlsx', kind: 'xlsx', range: 'A1:L11' },
  { id: 'quarterly-okr', file: 'quarterly-okr/example.xlsx', kind: 'xlsx', range: 'A1:E9' },
]

async function waitFor<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read().catch(() => undefined)
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(label)
}

function chromeHost(port: number): OfficePageCaptureHost {
  return {
    renderer: OFFICE_PAGE_RENDER_STEP,
    async capture(input: OfficePageCaptureInput): Promise<OfficePageCaptureResult> {
      const dir = await mkdtemp(join(tmpdir(), 'selection-office-render-'))
      const file = join(dir, 'page.html')
      await writeFile(file, input.html, { mode: 0o600 })
      const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(file).href)}`, { method: 'PUT' }).then(async response => {
        const body = await response.text()
        if (!response.ok) throw new Error(body)
        return JSON.parse(body) as { webSocketDebuggerUrl: string }
      })
      const ws = new WebSocket(created.webSocketDebuggerUrl)
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('Chrome 调试连接失败'))
      })
      let next = 0
      const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>()
      ws.onmessage = event => {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
        if (message.id && pending.has(message.id)) pending.get(message.id)!(message)
      }
      const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
        const id = ++next
        pending.set(id, message => {
          pending.delete(id)
          if (message.error) reject(new Error(message.error.message))
          else resolve(message.result)
        })
        ws.send(JSON.stringify({ id, method, params }))
      })
      try {
        const zoom = input.kind === 'xlsx' ? 1.25 : 1.5
        await send('Page.enable')
        await send('Runtime.enable')
        await send('Emulation.setDeviceMetricsOverride', {
          width: input.kind === 'xlsx' ? 1400 : 1100,
          height: 900,
          deviceScaleFactor: zoom,
          mobile: false,
        })
        await waitFor(async () => {
          const state = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
          return state.result?.value === 'complete' ? true : undefined
        }, '页面没有完成加载')
        const evalJson = async (request: unknown) => {
          const result = await send('Runtime.evaluate', {
            expression: officePageScript(request as never),
            awaitPromise: true,
            returnByValue: true,
          })
          if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
          return result.result?.value
        }
        const prepared = await evalJson({ op: 'prepare', kind: input.kind }) as { pageCount: number; sheets?: string[]; approximatePages?: boolean }
        const images = []
        const notFound: string[] = []
        const shoot = async (label: string, target: { page?: number; sheet?: string; range?: string }) => {
          const base = { kind: input.kind, maxCssEdge: input.maxCssEdge, ...target }
          const measured = await evalJson({ op: 'measure', ...base }) as { width: number; height: number; truncated?: boolean; sheet?: string } | null
          if (!measured) { notFound.push(label); return }
          const width = Math.max(320, measured.width + 24)
          const height = measured.height + 24
          await send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(width), height: Math.ceil(height), deviceScaleFactor: zoom, mobile: false })
          await new Promise(resolve => setTimeout(resolve, 80))
          const located = await evalJson({ op: 'locate', ...base }) as { x: number; y: number; width: number; height: number; truncated?: boolean; sheet?: string } | null
          if (!located) { notFound.push(label); return }
          const shot = await send('Page.captureScreenshot', {
            format: 'png',
            clip: {
              x: located.x,
              y: located.y,
              width: located.width,
              height: located.height,
              scale: zoom,
            },
          }) as { data: string }
          images.push({
            label: input.kind === 'xlsx' && located.sheet ? `${located.sheet}${target.range ? `!${target.range}` : ''}` : label,
            png: Buffer.from(shot.data, 'base64'),
            width: Math.round(located.width * zoom),
            height: Math.round(located.height * zoom),
            ...(located.truncated ? { truncated: true } : {}),
          })
        }
        if (input.kind === 'xlsx') {
          await shoot('sheet', { sheet: input.excel?.sheet, range: input.excel?.range })
        } else {
          for (const page of input.selectPages(prepared.pageCount)) await shoot(String(page), { page })
        }
        const fonts = await evalJson({ op: 'fonts', kind: input.kind }) as { missingFonts: string[] }
        return {
          pageCount: prepared.pageCount,
          ...(prepared.sheets ? { sheets: prepared.sheets } : {}),
          images,
          missingFonts: fonts.missingFonts ?? [],
          ...(notFound.length ? { notFound } : {}),
          ...(prepared.approximatePages ? { notes: ['页高按版心估算'] } : {}),
        }
      } finally {
        ws.close()
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}

const userData = await mkdtemp(join(tmpdir(), 'personal-office-chrome-'))
const port = 9334
const chrome = spawn('google-chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`,
  'about:blank',
], { stdio: 'ignore' })
await waitFor(async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`)
  return response.ok ? true : undefined
}, 'Chrome 没有启动')

const host = chromeHost(port)
await Bun.write(join(previewDir, '.keep'), '')
const { mkdirSync } = await import('node:fs')
mkdirSync(previewDir, { recursive: true })

try {
  for (const item of files) {
    const source = join(cases, item.file)
    const outcome = await renderOfficePages({
      path: source,
      outDir: previewDir,
      pages: item.kind === 'docx' ? '1' : undefined,
      range: item.range,
      host,
      loadHtml: async (file, signal) => {
        const proc = Bun.spawn([officecli, 'view', file, 'html'], { stdout: 'pipe', stderr: 'pipe', signal })
        const html = await new Response(proc.stdout).text()
        const code = await proc.exited
        if (code !== 0) throw new Error(await new Response(proc.stderr).text())
        return html
      },
    })
    const image = outcome.images[0]
    if (!image) throw new Error(`${item.id} 没有页图`)
    const pngPath = join(previewDir, `${item.id}.png`)
    await Bun.write(pngPath, Buffer.from(image.data, 'base64'))
    const fit = item.kind === 'xlsx' ? 'contain' as const : 'cover' as const
    await sharp(pngPath)
      .resize(1280, 720, { fit, position: 'left top', background: '#ffffff' })
      .webp({ quality: 82 })
      .toFile(join(covers, `${item.id}.webp`))
    console.log(item.id, outcome.pageCount, image.width, image.height, 'fonts', outcome.missingFonts.join(',') || 'none')
  }
} finally {
  chrome.kill()
  await rm(userData, { recursive: true, force: true }).catch(() => {})
}
