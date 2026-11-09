import { unzipSync } from 'fflate'

export const EMU_PER_POINT = 12700

export const IMPORT_LIMITS = {
  maxBytes: 32 * 1024 * 1024,
  maxUncompressed: 80 * 1024 * 1024,
  maxEntries: 4000,
  maxSlides: 40,
  maxNodes: 400,
} as const

export type XmlNode = { local: string; attrs: string; inner: string; raw: string }

export type PackageLimits = {
  maxBytes?: number
  maxUncompressed?: number
  maxEntries?: number
}

export function unzipPackage(bytes: Uint8Array, limits: PackageLimits = {}): Record<string, Uint8Array> {
  const maxBytes = limits.maxBytes ?? IMPORT_LIMITS.maxBytes
  const maxUncompressed = limits.maxUncompressed ?? IMPORT_LIMITS.maxUncompressed
  const maxEntries = limits.maxEntries ?? IMPORT_LIMITS.maxEntries
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('不是有效的 PPTX')
  if (bytes.byteLength > maxBytes) throw new Error(`PPTX 超过 ${Math.round(maxBytes / (1024 * 1024))}MB，已停止导入`)
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes) } catch { throw new Error('不是有效的 PPTX') }
  const names = Object.keys(files)
  if (names.length > maxEntries) throw new Error(`PPTX 条目超过 ${maxEntries}，已停止导入`)
  let total = 0
  for (const [name, value] of Object.entries(files)) {
    if (name.split('/').includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('PPTX 路径无效')
    total += value.byteLength
    if (total > maxUncompressed) throw new Error('PPTX 解压后超过上限，已停止导入')
  }
  return files
}

export function textOf(files: Record<string, Uint8Array>, path: string): string {
  const bytes = files[path]
  if (!bytes) return ''
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('PPTX 里有单份 XML 超过 8MB')
  return new TextDecoder('utf-8').decode(bytes)
}

export function rejectUnsafeXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('PPTX 含有不受支持的 XML 声明')
  if (/<\s*script\b/i.test(xml)) throw new Error('PPTX 含有脚本，已停止导入')
}

export function attr(source: string, name: string): string | undefined {
  if (!source) return undefined
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`).exec(source)?.[1]
}

export function firstLocal(xml: string, local: string): XmlNode | null {
  const marker = new RegExp(`<(?:[A-Za-z0-9]+:)?${local}\\b`)
  const found = marker.exec(xml)
  if (!found || found.index === undefined) return null
  return readNode(xml, found.index)?.node ?? null
}

export function firstLocalIn(node: XmlNode, local: string): XmlNode | undefined {
  return topLevel(node.inner).find(item => item.local === local)
}

export function topLevel(inner: string): XmlNode[] {
  const nodes: XmlNode[] = []
  let index = 0
  while (index < inner.length) {
    const start = inner.indexOf('<', index)
    if (start < 0) break
    if (inner.startsWith('</', start) || inner.startsWith('<?', start) || inner.startsWith('<!', start)) {
      const end = inner.indexOf('>', start)
      index = end < 0 ? inner.length : end + 1
      continue
    }
    const read = readNode(inner, start)
    if (!read) break
    nodes.push(read.node)
    index = read.end
  }
  return nodes
}

function readNode(xml: string, start: number): { node: XmlNode; end: number } | null {
  if (xml[start] !== '<' || xml.startsWith('</', start)) return null
  const gt = xml.indexOf('>', start)
  if (gt < 0) return null
  let open = xml.slice(start + 1, gt).trim()
  const selfClosing = open.endsWith('/')
  if (selfClosing) open = open.slice(0, -1).trim()
  const name = /^([A-Za-z0-9:]+)/.exec(open)?.[1]
  if (!name) return null
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const attrs = open.slice(name.length)
  if (selfClosing) return { node: { local, attrs, inner: '', raw: xml.slice(start, gt + 1) }, end: gt + 1 }
  let depth = 1
  const token = /<(\/?)([A-Za-z0-9:]+)([^>]*)>/g
  token.lastIndex = gt + 1
  let match: RegExpExecArray | null
  while ((match = token.exec(xml))) {
    const closing = match[1] === '/'
    const self = !closing && /\/\s*$/.test(match[3] ?? '')
    if (self) continue
    depth += closing ? -1 : 1
    if (depth === 0) {
      return { node: { local, attrs, inner: xml.slice(gt + 1, match.index), raw: xml.slice(start, token.lastIndex) }, end: token.lastIndex }
    }
  }
  return null
}

export function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all, token: string) => {
    if (token === 'amp') return '&'
    if (token === 'lt') return '<'
    if (token === 'gt') return '>'
    if (token === 'quot') return '"'
    if (token === 'apos') return "'"
    if (token.startsWith('#x')) return String.fromCodePoint(Number.parseInt(token.slice(2), 16))
    if (token.startsWith('#')) return String.fromCodePoint(Number.parseInt(token.slice(1), 10))
    return all
  })
}

export function points(emu: number): number | null {
  if (!Number.isFinite(emu)) return null
  return Math.round((emu / EMU_PER_POINT) * 100) / 100
}

export type Rel = { id: string; type: string; target: string; external: boolean }

export function readRels(xml: string): Rel[] {
  if (!xml) return []
  rejectUnsafeXml(xml)
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(match => ({
    id: attr(match[0], 'Id') ?? '',
    type: attr(match[0], 'Type') ?? '',
    target: attr(match[0], 'Target') ?? '',
    external: attr(match[0], 'TargetMode') === 'External',
  })).filter(item => item.id && item.target)
}

export function resolveRel(sourcePart: string, target: string): string | null {
  if (/^(https?:|mailto:)/i.test(target)) return null
  const raw = target.startsWith('/') ? target.slice(1) : joinPosix(sourcePart.split('/').slice(0, -1).join('/'), target)
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const path = parts.join('/')
  if (!path.startsWith('ppt/') || path.split('/').includes('..')) return null
  return path
}

function joinPosix(dir: string, target: string): string {
  return `${dir}/${target}`.replaceAll(/\/+/g, '/')
}

export function relsPath(part: string): string {
  const name = part.split('/').pop() ?? ''
  return `${part.split('/').slice(0, -1).join('/')}/_rels/${name}.rels`
}

export function themePath(files: Record<string, Uint8Array>): string {
  return Object.keys(files).find(name => /^ppt\/theme\/theme\d+\.xml$/.test(name)) ?? ''
}

export function slideParts(files: Record<string, Uint8Array>, presentation: string): string[] {
  const rels = readRels(textOf(files, 'ppt/_rels/presentation.xml.rels'))
  const ids = [...presentation.matchAll(/<p:sldId\b[^>]*>/g)].map(match => attr(match[0], 'r:id')).filter((id): id is string => !!id)
  return ids.map(id => {
    const rel = rels.find(item => item.id === id)
    if (!rel || rel.external) throw new Error('PPTX 页面关系无效')
    const path = resolveRel('ppt/presentation.xml', rel.target)
    if (!path || !files[path]) throw new Error('PPTX 页面关系无效')
    return path
  })
}
