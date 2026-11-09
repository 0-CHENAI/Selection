/**
 * #709 office_render 的桌面宿主：在不可见的离屏窗口里打开与「Office 协同」面板同源的
 * OfficeCLI HTML，用 webContents.capturePage 按页截图。窗口不联网、不开外部浏览器，
 * 每次渲染用完即销毁。
 */

import { BrowserWindow, session } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  OFFICE_PAGE_RENDER_STEP,
  officePageScript,
  type OfficePageCaptureHost,
  type OfficePageCaptureImage,
  type OfficePageCaptureInput,
  type OfficePageCaptureResult,
} from '@craft-agent/server-core/services'

const PARTITION = 'selection-office-render'
/** CSS → device pixels. A4 at 1.5 is about 1190×1680, slides at 1.125 are 1440 wide. */
const ZOOM = { docx: 1.5, pptx: 1.125, xlsx: 1.25 } as const
const SLIDE_VIEWPORT_CSS = { width: 1280, height: 760 }

type Measured = { width: number; height: number; truncated?: boolean; sheet?: string }
type Located = Measured & { x: number; y: number }

let partitionReady = false
function renderSession() {
  const part = session.fromPartition(PARTITION)
  if (!partitionReady) {
    partitionReady = true
    // Only the local HTML file and inline data may load. No network, no other files.
    part.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(data|blob):/i.test(details.url) || (/^file:/i.test(details.url) && /selection-office-render-[^/\\]+[/\\]page\.html$/i.test(decodeURIComponent(details.url)))
      callback({ cancel: !allowed })
    })
    part.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  return part
}

async function run<T>(win: BrowserWindow, request: Parameters<typeof officePageScript>[0]): Promise<T> {
  return win.webContents.executeJavaScript(officePageScript(request), true) as Promise<T>
}

function settle(ms = 120): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createElectronOfficeCaptureHost(): OfficePageCaptureHost {
  return {
    renderer: OFFICE_PAGE_RENDER_STEP,
    async capture(input: OfficePageCaptureInput): Promise<OfficePageCaptureResult> {
      const dir = await mkdtemp(join(tmpdir(), 'selection-office-render-'))
      const file = join(dir, 'page.html')
      await writeFile(file, input.html, { mode: 0o600 })
      const zoom = ZOOM[input.kind]
      const startWidth = input.kind === 'pptx' ? SLIDE_VIEWPORT_CSS.width : 1000
      const win = new BrowserWindow({
        show: false,
        width: Math.ceil(startWidth * zoom),
        height: Math.ceil(SLIDE_VIEWPORT_CSS.height * zoom),
        useContentSize: true,
        enableLargerThanScreen: true,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          offscreen: true,
          session: renderSession(),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          javascript: true,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: false,
        },
      })
      const abort = () => { if (!win.isDestroyed()) win.destroy() }
      input.signal.addEventListener('abort', abort, { once: true })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', event => event.preventDefault())
      try {
        await win.loadURL(pathToFileURL(file).href)
        win.webContents.setZoomFactor(zoom)
        await settle()
        const prepared = await run<{ pageCount: number; sheets?: string[]; approximatePages?: boolean }>(win, { op: 'prepare', kind: input.kind })
        const images: OfficePageCaptureImage[] = []
        const notFound: string[] = []
        const shoot = async (label: string, target: { page?: number; sheet?: string; range?: string }) => {
          const base = { kind: input.kind, maxCssEdge: input.maxCssEdge, ...target }
          const measured = await run<Measured | null>(win, { op: 'measure', ...base })
          if (!measured) { notFound.push(label); return }
          const width = input.kind === 'pptx' ? SLIDE_VIEWPORT_CSS.width : Math.max(320, measured.width + 24)
          win.setContentSize(Math.ceil(width * zoom), Math.ceil((measured.height + 24) * zoom))
          await settle()
          const located = await run<Located | null>(win, { op: 'locate', ...base })
          if (!located) { notFound.push(label); return }
          const image = await win.webContents.capturePage({
            x: Math.floor(located.x * zoom),
            y: Math.floor(located.y * zoom),
            width: Math.ceil(located.width * zoom),
            height: Math.ceil(located.height * zoom),
          })
          const size = image.getSize()
          images.push({ label: input.kind === 'xlsx' && located.sheet ? `${located.sheet}${target.range ? `!${target.range}` : ''}` : label, png: image.toPNG(), width: size.width, height: size.height, ...(located.truncated ? { truncated: true } : {}) })
        }
        if (input.kind === 'xlsx') {
          const sheet = input.excel?.sheet
          const label = `${sheet ?? prepared.sheets?.[0] ?? 'Sheet1'}${input.excel?.range ? `!${input.excel.range}` : ''}`
          await shoot(label, { sheet, range: input.excel?.range })
          if (notFound.length && sheet && prepared.sheets && !prepared.sheets.includes(sheet)) {
            notFound[notFound.length - 1] = `sheet "${sheet}" (sheets: ${prepared.sheets.join(', ')})`
          } else if (notFound.length && input.excel?.range) {
            notFound[notFound.length - 1] = `${label} (no cells in that range)`
          }
        } else {
          for (const page of input.selectPages(prepared.pageCount)) {
            if (input.signal.aborted) break
            await shoot(String(page), { page })
          }
        }
        const fonts = await run<{ missingFonts: string[] }>(win, { op: 'fonts', kind: input.kind })
        const notes = prepared.approximatePages
          ? ['Part of this document has no explicit page breaks; those parts were cut at the page height, so page numbers can differ slightly from Word.']
          : []
        return { pageCount: prepared.pageCount, ...(prepared.sheets?.length ? { sheets: prepared.sheets } : {}), images, missingFonts: fonts.missingFonts, ...(notFound.length ? { notFound } : {}), ...(notes.length ? { notes } : {}) }
      } finally {
        input.signal.removeEventListener('abort', abort)
        if (!win.isDestroyed()) win.destroy()
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}
