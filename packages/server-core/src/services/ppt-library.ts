import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { DEFAULT_MAX_MESSAGE_BYTES, type PptTemplate } from '@craft-agent/shared/protocol'
import { resolveOfficecliBinary } from '@craft-agent/shared/utils/officecli'

const ID_PATTERN = /^custom-[a-f0-9]{16}$/
const MAX_BYTES = 8 * 1024 * 1024
const MAX_SLIDES = 30
const MAX_SLOTS = 200
const EMU_PER_POINT = 12700

export interface PptLibraryTheme {
  name: string
  colors: Record<string, string>
  fonts: { majorLatin?: string; majorEastAsia?: string; minorLatin?: string; minorEastAsia?: string }
  masters: string[]
  layouts: string[]
}

export interface PptLibrarySlot {
  id: string
  page: number
  type: string
  text: string
  bounds: { x: number; y: number; w: number; h: number }
}

export interface PptLibraryRecord {
  id: string
  title: string
  sha256: string
  canvas: { width: number; height: number; label: string }
  pageCount: number
  createdAt: number
  updatedAt: number
  /** How slide previews were produced. Older libraries omit this and keep SVG files. */
  preview?: 'officecli' | 'geometry' | 'mixed'
  /** `deck` stores selection-deck JSON. Older records and PPTX uploads omit this. */
  sourceKind?: 'pptx' | 'deck'
}

interface ParsedDeck {
  canvas: PptLibraryRecord['canvas']
  theme: PptLibraryTheme
  slots: PptLibrarySlot[]
  previews: string[]
}

/** User data directory. Read at call time so a restarted process and tests share the same files. */
export function pptTemplateLibraryRoot(): string {
  const base = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.selection')
  return join(base, 'ppt-templates')
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('/'))
}

function libraryDir(root: string): string {
  mkdirSync(root, { recursive: true })
  return realpathSync(root)
}

function templateDir(root: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error('Unknown PPT template')
  const base = libraryDir(root)
  const dir = resolve(base, id)
  if (!within(base, dir)) throw new Error('Unknown PPT template')
  return dir
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function titleFromName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? ''
  const title = base.replace(/\.(pptx|json)$/i, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80)
  return title || '未命名模板'
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}

function colorOf(block: string): string | undefined {
  const srgb = /<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(block)
  if (srgb) return `#${srgb[1]!.toUpperCase()}`
  const sys = /<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/.exec(block)
  if (sys) return `#${sys[1]!.toUpperCase()}`
  return undefined
}

function block(xml: string, tag: string): string {
  return new RegExp(`<a:${tag}\\b[^>]*>([\\s\\S]*?)</a:${tag}>`).exec(xml)?.[1] ?? ''
}

function typeface(xml: string, script?: string): string | undefined {
  if (script) {
    const face = new RegExp(`<a:font\\b[^>]*\\bscript="${script}"[^>]*\\btypeface="([^"]+)"`).exec(xml)?.[1]
      ?? new RegExp(`<a:font\\b[^>]*\\btypeface="([^"]+)"[^>]*\\bscript="${script}"`).exec(xml)?.[1]
    if (face) return face
  }
  const face = attr(/<a:latin\b[^>]*>/.exec(xml)?.[0] ?? '', 'typeface')
    || attr(/<a:ea\b[^>]*>/.exec(xml)?.[0] ?? '', 'typeface')
  return face || undefined
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes) } catch { throw new Error('Invalid PPTX') }
  if (Object.keys(files).some(name => name.split('/').includes('..') || name.startsWith('/'))) throw new Error('Invalid PPTX')
  return files
}

function textOf(path: string, files: Record<string, Uint8Array>): string {
  const bytes = files[path]
  if (!bytes) throw new Error('Invalid PPTX')
  return strFromU8(bytes)
}

function slidePaths(files: Record<string, Uint8Array>): string[] {
  const presentation = textOf('ppt/presentation.xml', files)
  const rels = textOf('ppt/_rels/presentation.xml.rels', files)
  const relationships = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(match => match[0])
  const slideIds = [...presentation.matchAll(/<p:sldId\b[^>]*>/g)].map(match => {
    const tag = match[0]
    return /r:id="([^"]+)"/.exec(tag)?.[1]
  }).filter((id): id is string => !!id)
  return slideIds.slice(0, MAX_SLIDES).map(id => {
    const tag = relationships.find(item => attr(item, 'Id') === id)
    const target = tag ? attr(tag, 'Target') : undefined
    if (!target || target.includes('..')) throw new Error('Invalid PPTX')
    const path = target.replace(/^\//, '').replace(/^ppt\//, '')
    return `ppt/${path}`
  })
}

function namesFrom(files: Record<string, Uint8Array>, prefix: string): string[] {
  return Object.keys(files)
    .filter(name => name.startsWith(prefix) && name.endsWith('.xml') && !name.includes('/_rels/'))
    .sort()
    .map(name => attr(/<p:cSld\b[^>]*>/.exec(strFromU8(files[name]!))?.[0] ?? '', 'name') || name.split('/').pop()!.replace(/\.xml$/, ''))
}

function parseTheme(files: Record<string, Uint8Array>): PptLibraryTheme {
  const themePath = Object.keys(files).find(name => /^ppt\/theme\/theme\d+\.xml$/.test(name))
  if (!themePath) throw new Error('Invalid PPTX')
  const xml = strFromU8(files[themePath]!)
  const colors: Record<string, string> = {}
  for (const name of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
    const color = colorOf(block(xml, name))
    if (color) colors[name] = color
  }
  const major = block(xml, 'majorFont')
  const minor = block(xml, 'minorFont')
  return {
    name: attr(/<a:theme\b[^>]*>/.exec(xml)?.[0] ?? '', 'name') || attr(/<a:clrScheme\b[^>]*>/.exec(xml)?.[0] ?? '', 'name') || 'theme',
    colors,
    fonts: {
      majorLatin: typeface(major),
      majorEastAsia: typeface(major, 'Hans') || typeface(major),
      minorLatin: typeface(minor),
      minorEastAsia: typeface(minor, 'Hans') || typeface(minor),
    },
    masters: namesFrom(files, 'ppt/slideMasters/'),
    layouts: namesFrom(files, 'ppt/slideLayouts/'),
  }
}

function canvasFrom(presentation: string): PptLibraryRecord['canvas'] {
  const tag = /<p:sldSz\b[^>]*>/.exec(presentation)?.[0] ?? ''
  const cx = Number(attr(tag, 'cx'))
  const cy = Number(attr(tag, 'cy'))
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) throw new Error('Invalid PPTX')
  const width = Math.max(1, Math.round(cx / EMU_PER_POINT))
  const height = Math.max(1, Math.round(cy / EMU_PER_POINT))
  const ratio = width / height
  const known: Array<[number, string]> = [[16 / 9, '16:9'], [4 / 3, '4:3'], [1, '1:1'], [9 / 16, '9:16'], [3 / 4, '3:4']]
  return { width, height, label: known.find(([value]) => Math.abs(ratio - value) < 0.03)?.[1] ?? `${width}×${height}` }
}

function shapesOf(slide: string): string[] {
  return [...slide.matchAll(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g)].map(match => match[0]).slice(0, 80)
}

function shapeFill(shape: string): string | undefined {
  const props = /<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/.exec(shape)?.[1] ?? ''
  if (/<a:noFill\s*\/>/.test(props)) return undefined
  return colorOf(props)
}

function point(value: number): string {
  return (value / EMU_PER_POINT).toFixed(2)
}

function parseSlide(slide: string, page: number, cx: number, cy: number, slots: PptLibrarySlot[]): string {
  const background = colorOf(/<p:bg\b[^>]*>[\s\S]*?<\/p:bg>/.exec(slide)?.[0] ?? '') ?? '#FFFFFF'
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${point(cx)} ${point(cy)}">`, `<rect width="100%" height="100%" fill="${background}"/>`]
  shapesOf(slide).forEach((shape, index) => {
    const xfrm = /<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(shape)?.[1] ?? ''
    const off = /<a:off\b[^>]*>/.exec(xfrm)?.[0] ?? ''
    const ext = /<a:ext\b[^>]*>/.exec(xfrm)?.[0] ?? ''
    const x = Number(attr(off, 'x'))
    const y = Number(attr(off, 'y'))
    const w = Number(attr(ext, 'cx'))
    const h = Number(attr(ext, 'cy'))
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return
    const fill = shapeFill(shape)
    if (fill) parts.push(`<rect x="${point(x)}" y="${point(y)}" width="${point(w)}" height="${point(h)}" fill="${fill}"/>`)
    const text = [...shape.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1] ?? '')).join('').replace(/\s+/g, ' ').trim()
    if (!text) return
    const placeholder = /<p:ph\b[^>]*>/.exec(shape)?.[0]
    const type = (placeholder && attr(placeholder, 'type')) || 'text'
    if (slots.length < MAX_SLOTS) {
      slots.push({
        id: `p${page}-${index + 1}`,
        page,
        type,
        text: text.slice(0, 500),
        bounds: {
          x: Math.round(x / EMU_PER_POINT),
          y: Math.round(y / EMU_PER_POINT),
          w: Math.round(w / EMU_PER_POINT),
          h: Math.round(h / EMU_PER_POINT),
        },
      })
    }
    const size = Number(/<a:rPr\b[^>]*\bsz="(\d+)"/.exec(shape)?.[1] ?? 1800) / 100
    const ink = colorOf(/<a:rPr\b[\s\S]*?<\/a:rPr>/.exec(shape)?.[0] ?? '') ?? '#1A1A1A'
    const baseline = y / EMU_PER_POINT + Math.min(h / EMU_PER_POINT * 0.72, size)
    parts.push(`<text x="${point(x)}" y="${baseline.toFixed(2)}" fill="${ink}" font-size="${size}" font-family="sans-serif">${xmlEscape(text.slice(0, 80))}</text>`)
  })
  parts.push('</svg>')
  return parts.join('')
}

export function geometricPptxPreviews(bytes: Uint8Array): string[] {
  return parsePptx(bytes).previews
}

export function parsePptx(bytes: Uint8Array): ParsedDeck {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Invalid PPTX')
  const files = unzip(bytes)
  if (!files['ppt/presentation.xml']) throw new Error('Invalid PPTX')
  const presentation = textOf('ppt/presentation.xml', files)
  const size = /<p:sldSz\b[^>]*>/.exec(presentation)?.[0] ?? ''
  const cx = Number(attr(size, 'cx'))
  const cy = Number(attr(size, 'cy'))
  const slots: PptLibrarySlot[] = []
  const previews = slidePaths(files).map((path, index) => parseSlide(textOf(path, files), index + 1, cx, cy, slots))
  if (!previews.length) throw new Error('Invalid PPTX')
  return { canvas: canvasFrom(presentation), theme: parseTheme(files), slots, previews }
}

function readRecord(dir: string): PptLibraryRecord | null {
  try { return readJson<PptLibraryRecord>(join(dir, 'meta.json')) } catch { return null }
}

function recordMatchesDir(root: string, record: PptLibraryRecord | null, dirName: string): record is PptLibraryRecord {
  return !!record && record.id === dirName && ID_PATTERN.test(record.id) && within(resolve(root), resolve(root, dirName))
}

export function listPptCustomTemplates(root = pptTemplateLibraryRoot()): PptLibraryRecord[] {
  let names: string[] = []
  try { names = readdirSync(root) } catch { return [] }
  const records: PptLibraryRecord[] = []
  for (const name of names) {
    if (!ID_PATTERN.test(name)) continue
    const record = readRecord(join(root, name))
    if (recordMatchesDir(root, record, name)) records.push(record)
  }
  return records.sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title))
}

type PreviewRaster = (pptxPath: string, page: number, outPath: string) => boolean

let previewRaster: PreviewRaster | undefined

/** Tests inject a raster so preview assertions do not depend on a local browser. */
export function setPptPreviewRasterForTests(raster: PreviewRaster | null): void {
  previewRaster = raster ?? undefined
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function fileSize(path: string): number {
  try { return statSync(path).size } catch { return 0 }
}

function pngMagic(path: string): boolean {
  try {
    const fd = openSync(path, 'r')
    const header = Buffer.alloc(8)
    try { readSync(fd, header, 0, 8, 0) } finally { closeSync(fd) }
    return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
  } catch { return false }
}

function killProcess(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
  }
  try { child.kill('SIGKILL') } catch { /* already gone */ }
}

function officecliScreenshot(bin: string, pptx: string, page: number, outFile: string): boolean {
  let child: ChildProcess
  try {
    child = spawn(bin, [
      'view', pptx, 'screenshot',
      '--page', String(page),
      '--render', 'html',
      '--screenshot-width', '1600',
      '--screenshot-height', '900',
      '-o', outFile,
    ], {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
    })
  } catch {
    return false
  }
  const deadline = Date.now() + 10_000
  let last = -1
  let stableSince = 0
  let ready = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      ready = fileSize(outFile) > 800 && pngMagic(outFile)
      break
    }
    const size = fileSize(outFile)
    if (size > 800 && size === last) {
      if (stableSince === 0) stableSince = Date.now()
      if (Date.now() - stableSince >= 300 && pngMagic(outFile)) {
        ready = true
        break
      }
    } else {
      last = size
      stableSince = 0
    }
    sleepSync(100)
  }
  if (!ready) ready = fileSize(outFile) > 800 && pngMagic(outFile)
  killProcess(child)
  return ready
}

function rasterSlide(pptx: string, page: number, outFile: string): boolean {
  try {
    if (previewRaster) return previewRaster(pptx, page, outFile) && pngMagic(outFile)
    const bin = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
    if (!bin || /\.(cmd|bat)$/i.test(bin)) return false
    return officecliScreenshot(bin, pptx, page, outFile)
  } catch {
    return false
  }
}

function writePreviews(dir: string, pptxPath: string, geometry: string[]): 'officecli' | 'geometry' | 'mixed' {
  let pngs = 0
  geometry.forEach((svg, index) => {
    const stem = join(dir, 'previews', String(index + 1).padStart(2, '0'))
    const png = `${stem}.png`
    let ok = false
    try { ok = rasterSlide(pptxPath, index + 1, png) } catch { ok = false }
    if (ok) {
      pngs += 1
      return
    }
    try { unlinkSync(png) } catch { /* no partial file */ }
    writeFileSync(`${stem}.svg`, svg)
  })
  if (pngs === geometry.length) return 'officecli'
  if (pngs === 0) return 'geometry'
  return 'mixed'
}

function previewFile(dir: string, page: number): string {
  const stem = join(dir, 'previews', String(page).padStart(2, '0'))
  if (existsSync(`${stem}.png`)) return `${stem}.png`
  return `${stem}.svg`
}

function previewDataUrl(path: string): string {
  const mime = path.endsWith('.png') ? 'image/png' : 'image/svg+xml'
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

export function customTemplateCard(record: PptLibraryRecord, root = pptTemplateLibraryRoot()): PptTemplate {
  const dir = templateDir(root, record.id)
  const cover = previewDataUrl(previewFile(dir, 1))
  const references = [2, 3]
    .filter(page => page <= record.pageCount)
    .map(page => previewDataUrl(previewFile(dir, page)))
  return {
    id: record.id,
    title: record.title,
    category: '自定义',
    canvas: record.canvas.label,
    pages: record.pageCount,
    cover,
    referencePages: references,
  }
}

export function listCustomCatalogTemplates(root = pptTemplateLibraryRoot()): PptTemplate[] {
  return listPptCustomTemplates(root).flatMap(record => {
    try { return [customTemplateCard(record, root)] } catch { return [] }
  })
}

export function customTemplatePages(id: string, root = pptTemplateLibraryRoot()): string[] {
  const record = readRecord(templateDir(root, id))
  if (!record || record.id !== id) throw new Error('Unknown PPT template')
  const pages: string[] = []
  for (let page = 1; page <= record.pageCount; page++) pages.push(previewDataUrl(previewFile(templateDir(root, id), page)))
  return pages
}

/** Do not send the original 1600px custom rasters in the lightweight gallery. */
export async function thumbnailPptTemplateCard(card: PptTemplate): Promise<PptTemplate> {
  const thumbnail = async (data: string) => {
    if (data.startsWith('data:image/svg+xml;')) return data
    const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
    const image = await sharp(bytes).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer()
    return `data:image/webp;base64,${image.toString('base64')}`
  }
  return { ...card, cover: await thumbnail(card.cover), referencePages: await Promise.all(card.referencePages.map(thumbnail)) }
}

const detailPending = new Map<string, Promise<string>>()
let previewHtml: ((source: string, page: number) => Promise<string>) | undefined

export function setPptPreviewHtmlForTests(renderer: typeof previewHtml): void { previewHtml = renderer }

async function renderPreviewHtml(source: string, page: number): Promise<string> {
  if (previewHtml) return previewHtml(source, page)
  const bin = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
  if (!bin || /\.(cmd|bat)$/i.test(bin)) throw new Error('PPT preview renderer unavailable')
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['view', source, 'html', '--page', String(page)], {
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' },
    })
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => { killProcess(child); reject(new Error('PPT preview render timed out')) }, 20_000)
    child.stdout!.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes * 4 / 3 + 4096 >= DEFAULT_MAX_MESSAGE_BYTES) { killProcess(child); reject(new Error('PPT preview exceeds transport size limit')); return }
      chunks.push(chunk)
    })
    child.on('error', () => { clearTimeout(timer); reject(new Error('PPT preview render failed')) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error('PPT preview render failed'))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}
let detailRenders = 0
const detailWaiters: Array<() => void> = []

async function acquireDetailRenderer(): Promise<() => void> {
  if (detailRenders >= 2) await new Promise<void>(resolve => detailWaiters.push(resolve))
  else detailRenders++
  return () => {
    const next = detailWaiters.shift()
    if (next) next()
    else detailRenders--
  }
}

/** Generated details are disposable; source files, import previews and metadata are never evicted. */
function trimDetailCache(root: string, keep: string): void {
  const files: Array<{ path: string; size: number; accessed: number }> = []
  try {
    for (const id of readdirSync(root).filter(id => ID_PATTERN.test(id))) {
      const dir = join(root, id, 'previews')
      for (const name of readdirSync(dir).filter(name => /^\d+\.detail-v1\.html$/.test(name))) {
        const path = join(dir, name)
        const stat = statSync(path)
        files.push({ path, size: stat.size, accessed: stat.atimeMs })
      }
    }
    let bytes = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.accessed - b.accessed)) {
      if (bytes <= 128 * 1024 * 1024) break
      if (file.path === keep || detailPending.has(file.path)) continue
      unlinkSync(file.path)
      bytes -= file.size
    }
  } catch { /* Another request may delete a custom template while the cache is being trimmed. */ }
}

/** Upgrade existing imported previews from the original PPTX, never from its small PNG. */
export async function customTemplatePreview(id: string, page: number | undefined, root = pptTemplateLibraryRoot()): Promise<string> {
  const dir = templateDir(root, id)
  const record = readRecord(dir)
  if (!record || record.id !== id || !Number.isInteger(page) || page! < 1 || page! > record.pageCount) throw new Error('Unknown PPT template page')
  const legacy = previewFile(dir, page!)
  const stem = String(page).padStart(2, '0')
  const target = join(dir, 'previews', `${stem}.detail-v1.html`)
  const encode = () => {
    const bytes = readFileSync(target)
    if (bytes.byteLength * 4 / 3 + 1024 >= DEFAULT_MAX_MESSAGE_BYTES) throw new Error('PPT preview exceeds transport size limit')
    return `data:text/html;base64,${bytes.toString('base64')}`
  }
  if (existsSync(target)) return encode()
  if (!existsSync(join(dir, 'source.pptx'))) return previewDataUrl(legacy)
  const existing = detailPending.get(target)
  if (existing) return existing
  const promise = (async () => {
    const release = await acquireDetailRenderer()
    let temp: string | undefined
    try {
      // The template may have been removed while this render waited for a slot.
      temp = mkdtempSync(join(dir, 'previews', '.detail-'))
      let html = await renderPreviewHtml(join(dir, 'source.pptx'), page!)
      if (!/<html\b/i.test(html) || !/<head\b/i.test(html)) throw new Error('Invalid PPT preview HTML')
      // Use the same HTML scene as import screenshots, without rasterizing it. Its existing
      // screenshot mode removes viewer chrome and fits the actual slide to the iframe.
      html = html.replaceAll("location.hash.indexOf('screenshot')>=0", 'true')
      const csp = "default-src 'none'; script-src 'unsafe-inline' https://d.officecli.ai https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://d.officecli.ai https://cdn.jsdelivr.net; img-src data: blob:; font-src data: https://d.officecli.ai https://cdn.jsdelivr.net; connect-src https://d.officecli.ai https://cdn.jsdelivr.net; base-uri 'none'; form-action 'none'"
      html = html.replace(/<head\b[^>]*>/i, `$&<meta http-equiv="Content-Security-Policy" content="${csp}">`)
      const output = join(temp, 'page.html')
      writeFileSync(output, html)
      renameSync(output, target)
      const encoded = encode()
      trimDetailCache(root, target)
      return encoded
    } catch (error) {
      // Keep the existing geometric fallback if this installation has no HTML renderer.
      if (legacy.endsWith('.svg')) return previewDataUrl(legacy)
      throw error
    } finally {
      if (temp) rmSync(temp, { recursive: true, force: true })
      release()
    }
  })().finally(() => { detailPending.delete(target) })
  detailPending.set(target, promise)
  return promise
}

export function customTemplateReference(id: string, root = pptTemplateLibraryRoot()): string | null {
  if (!ID_PATTERN.test(id)) return null
  const dir = templateDir(root, id)
  const record = readRecord(dir)
  if (!record || record.id !== id) return null
  const deck = join(dir, 'deck.json')
  const source = join(dir, 'source.pptx')
  const theme = join(dir, 'theme.json')
  const slots = join(dir, 'slots.json')
  const previews = Array.from({ length: record.pageCount }, (_, index) => previewFile(dir, index + 1))
  const storedDeck = existsSync(deck)
  const lines = [
    `Selected custom template ${record.id} (${record.title}) from the user's template library.`,
    storedDeck
      ? `Stored deck.json (visual reference only, not the session project): ${deck}`
      : `Use this stored copy, not a temporary upload: ${source}`,
    `Parsed theme: ${theme}`,
    `Replaceable slots: ${slots}`,
    ...previews.map((path, index) => `Preview page ${index + 1}: ${path}`),
  ]
  if (existsSync(theme)) lines.push(`Theme JSON:\n${readFileSync(theme, 'utf8')}`)
  if (existsSync(slots)) lines.push(`Slots JSON:\n${readFileSync(slots, 'utf8')}`)
  if (storedDeck) lines.push('Issue #714 will copy a personal template into the session project as an editable deck. This upload only stores and lists the file. Do not write this library copy over the session deck, and do not duplicate that project step.')
  return lines.join('\n')
}

function isDeckUpload(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.json')
}

function hexColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : undefined
}

function deckPreviewSvg(deck: { canvas?: { width?: number; height?: number }; theme?: { colors?: Record<string, string> }; pages?: Array<{ background?: string; elements?: Array<{ type?: string; text?: string; bounds?: { x?: number; y?: number; w?: number; h?: number }; font?: { size?: number; color?: string } }> }> }, pageIndex: number): string {
  const page = deck.pages?.[pageIndex]
  const width = Math.max(1, Number(deck.canvas?.width) || 960)
  const height = Math.max(1, Number(deck.canvas?.height) || 540)
  const colors = deck.theme?.colors ?? {}
  const token = (value: unknown) => {
    if (typeof value !== 'string') return undefined
    if (value.startsWith('#') && hexColor(value)) return value
    if (value.startsWith('$')) return hexColor(colors[value.slice(1)])
    return undefined
  }
  const background = token(page?.background) ?? token(colors.paper) ?? '#F7F4EB'
  const ink = token(colors.ink) ?? '#1A1A1A'
  const texts = (page?.elements ?? []).filter(element => element.type === 'text' && element.text).slice(0, 6)
  const body = texts.map(element => {
    const x = Number(element.bounds?.x) || 48
    const y = Number(element.bounds?.y) || 48
    const size = Number(element.font?.size) || 18
    const color = token(element.font?.color) ?? ink
    return `<text x="${x}" y="${y + size}" fill="${color}" font-size="${size}" font-family="sans-serif">${xmlEscape(String(element.text).replace(/\s+/g, ' ').slice(0, 80))}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/>${body}</svg>`
}

function importDeckTemplate(bytes: Uint8Array, fileName: string, root: string): { record: PptLibraryRecord; duplicate: boolean } {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error('Invalid deck.json')
  let deck: { format?: string; title?: string; canvas?: { width?: number; height?: number }; theme?: { name?: string; colors?: Record<string, string> }; pages?: Array<{ id?: string; elements?: Array<{ type?: string; text?: string; bounds?: { x?: number; y?: number; w?: number; h?: number } }> }> }
  try { deck = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new Error('Invalid deck.json') }
  const width = Number(deck.canvas?.width)
  const height = Number(deck.canvas?.height)
  const pages = deck.pages
  if (deck.format !== 'selection-deck' || !Array.isArray(pages) || pages.length < 1 || pages.length > MAX_SLIDES || !Number.isFinite(width) || !Number.isFinite(height) || width < 200 || width > 2000 || height < 200 || height > 2000) throw new Error('Invalid deck.json')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const id = `custom-${sha256.slice(0, 16)}`
  const base = libraryDir(root)
  const existing = listPptCustomTemplates(base).find(record => record.sha256 === sha256)
  if (existing) return { record: existing, duplicate: true }
  const dir = templateDir(base, id)
  mkdirSync(join(dir, 'previews'), { recursive: true })
  writeFileSync(join(dir, 'deck.json'), bytes)
  const colors = deck.theme?.colors ?? {}
  const theme = { name: deck.theme?.name || deck.title || 'deck', colors, fonts: {}, masters: [], layouts: [] }
  const slots: PptLibrarySlot[] = []
  pages.forEach((page, pageIndex) => {
    for (const element of page.elements ?? []) {
      if (element.type !== 'text' || !element.text || slots.length >= MAX_SLOTS) continue
      const bounds = element.bounds ?? {}
      slots.push({
        id: `p${pageIndex + 1}-${slots.length + 1}`,
        page: pageIndex + 1,
        type: 'text',
        text: String(element.text).slice(0, 500),
        bounds: { x: Math.round(Number(bounds.x) || 0), y: Math.round(Number(bounds.y) || 0), w: Math.round(Number(bounds.w) || 0), h: Math.round(Number(bounds.h) || 0) },
      })
    }
    writeFileSync(join(dir, 'previews', `${String(pageIndex + 1).padStart(2, '0')}.svg`), deckPreviewSvg(deck, pageIndex))
  })
  writeFileSync(join(dir, 'theme.json'), `${JSON.stringify(theme, null, 2)}\n`)
  writeFileSync(join(dir, 'slots.json'), `${JSON.stringify(slots, null, 2)}\n`)
  const ratio = width / height
  const known: Array<[number, string]> = [[16 / 9, '16:9'], [4 / 3, '4:3'], [1, '1:1'], [9 / 16, '9:16'], [3 / 4, '3:4']]
  const now = Date.now()
  const record: PptLibraryRecord = {
    id,
    title: titleFromName(fileName),
    sha256,
    canvas: { width: Math.round(width), height: Math.round(height), label: known.find(([value]) => Math.abs(ratio - value) < 0.03)?.[1] ?? `${Math.round(width)}×${Math.round(height)}` },
    pageCount: pages.length,
    createdAt: now,
    updatedAt: now,
    preview: 'geometry',
    sourceKind: 'deck',
  }
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(record, null, 2)}\n`)
  return { record, duplicate: false }
}

export function importPptTemplate(bytes: Uint8Array, fileName: string, root = pptTemplateLibraryRoot()): { record: PptLibraryRecord; duplicate: boolean } {
  if (isDeckUpload(fileName)) return importDeckTemplate(bytes, fileName, root)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error('Invalid PPTX')
  const parsed = parsePptx(bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const id = `custom-${sha256.slice(0, 16)}`
  const base = libraryDir(root)
  const existing = listPptCustomTemplates(base).find(record => record.sha256 === sha256)
  if (existing) return { record: existing, duplicate: true }
  const dir = templateDir(base, id)
  mkdirSync(join(dir, 'previews'), { recursive: true })
  writeFileSync(join(dir, 'source.pptx'), bytes)
  writeFileSync(join(dir, 'theme.json'), `${JSON.stringify(parsed.theme, null, 2)}\n`)
  writeFileSync(join(dir, 'slots.json'), `${JSON.stringify(parsed.slots, null, 2)}\n`)
  const preview = writePreviews(dir, join(dir, 'source.pptx'), parsed.previews)
  const now = Date.now()
  const record: PptLibraryRecord = {
    id,
    title: titleFromName(fileName),
    sha256,
    canvas: parsed.canvas,
    pageCount: parsed.previews.length,
    createdAt: now,
    updatedAt: now,
    preview,
    sourceKind: 'pptx',
  }
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(record, null, 2)}\n`)
  return { record, duplicate: false }
}

export function renamePptTemplate(id: string, title: string, root = pptTemplateLibraryRoot()): PptLibraryRecord {
  const dir = templateDir(root, id)
  const record = readRecord(dir)
  if (!record || record.id !== id) throw new Error('Unknown PPT template')
  const next = title.replace(/[\u0000-\u001f]/g, '').trim()
  if (!next || next.length > 80) throw new Error('Invalid PPT template title')
  const updated = { ...record, title: next, updatedAt: Date.now() }
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(updated, null, 2)}\n`)
  return updated
}

export function deletePptTemplate(id: string, root = pptTemplateLibraryRoot()): void {
  const dir = templateDir(root, id)
  const record = readRecord(dir)
  if (!record || record.id !== id) throw new Error('Unknown PPT template')
  rmSync(dir, { recursive: true, force: true })
}

export function exportPptTemplate(id: string, root = pptTemplateLibraryRoot()): { name: string; bytes: Uint8Array } {
  const dir = templateDir(root, id)
  const record = readRecord(dir)
  if (!record || record.id !== id) throw new Error('Unknown PPT template')
  const deck = join(dir, 'deck.json')
  if (record.sourceKind === 'deck' || (existsSync(deck) && !existsSync(join(dir, 'source.pptx')))) {
    const name = `${record.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'template'}.json`
    return { name, bytes: new Uint8Array(readFileSync(deck)) }
  }
  const name = `${record.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'template'}.pptx`
  return { name, bytes: new Uint8Array(readFileSync(join(dir, 'source.pptx'))) }
}
