import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { PptTemplate } from '@craft-agent/shared/protocol'

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
  const title = base.replace(/\.pptx$/i, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80)
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

function previewDataUrl(path: string): string {
  return `data:image/svg+xml;base64,${readFileSync(path).toString('base64')}`
}

export function customTemplateCard(record: PptLibraryRecord, root = pptTemplateLibraryRoot()): PptTemplate {
  const dir = templateDir(root, record.id)
  const cover = previewDataUrl(join(dir, 'previews', '01.svg'))
  const references = [2, 3]
    .filter(page => page <= record.pageCount)
    .map(page => previewDataUrl(join(dir, 'previews', `${String(page).padStart(2, '0')}.svg`)))
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
  for (let page = 1; page <= record.pageCount; page++) pages.push(previewDataUrl(join(templateDir(root, id), 'previews', `${String(page).padStart(2, '0')}.svg`)))
  return pages
}

export function customTemplateReference(id: string, root = pptTemplateLibraryRoot()): string | null {
  if (!ID_PATTERN.test(id)) return null
  const dir = templateDir(root, id)
  const record = readRecord(dir)
  if (!record || record.id !== id) return null
  const source = join(dir, 'source.pptx')
  const theme = join(dir, 'theme.json')
  const slots = join(dir, 'slots.json')
  const previews = Array.from({ length: record.pageCount }, (_, index) => join(dir, 'previews', `${String(index + 1).padStart(2, '0')}.svg`))
  return [
    `Selected custom template ${record.id} (${record.title}) from the user's template library.`,
    `Use this stored copy, not a temporary upload: ${source}`,
    `Parsed theme: ${theme}`,
    `Replaceable slots: ${slots}`,
    ...previews.map((path, index) => `Preview page ${index + 1}: ${path}`),
    `Theme JSON:\n${readFileSync(theme, 'utf8')}`,
    `Slots JSON:\n${readFileSync(slots, 'utf8')}`,
  ].join('\n')
}

export function importPptTemplate(bytes: Uint8Array, fileName: string, root = pptTemplateLibraryRoot()): { record: PptLibraryRecord; duplicate: boolean } {
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
  parsed.previews.forEach((svg, index) => writeFileSync(join(dir, 'previews', `${String(index + 1).padStart(2, '0')}.svg`), svg))
  const now = Date.now()
  const record: PptLibraryRecord = {
    id,
    title: titleFromName(fileName),
    sha256,
    canvas: parsed.canvas,
    pageCount: parsed.previews.length,
    createdAt: now,
    updatedAt: now,
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
  const name = `${record.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'template'}.pptx`
  return { name, bytes: new Uint8Array(readFileSync(join(dir, 'source.pptx'))) }
}
