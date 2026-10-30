/**
 * 在案例副本上改输入格、把求出的缓存写回公式格。
 * 不改图表部件，也不改案例原件。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { cellRef, readXlsxCells, type CellData, type CellScalar } from '../office-render-poc/formula.ts'

export interface CellPatch {
  sheet: string
  address: string
  value: CellScalar
}

export function sheetTargets(bytes: Uint8Array): Map<string, string> {
  const files = unzipSync(bytes)
  const workbook = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array())
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'] ?? new Uint8Array())
  const relMap = new Map<string, string>()
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = /Id="([^"]+)"/.exec(tag)?.[1]
    const target = /Target="([^"]+)"/.exec(tag)?.[1]
    if (id && target) relMap.set(id, target.replace(/^\//, ''))
  }
  const targets = new Map<string, string>()
  const stripped = workbook.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1')
  for (const tag of stripped.match(/<sheet\b[^>]*>/g) ?? []) {
    const name = /name="([^"]+)"/.exec(tag)?.[1]
    const id = /r:id="([^"]+)"/.exec(tag)?.[1]
    const target = id ? relMap.get(id) : undefined
    if (!name || !target) continue
    const path = target.startsWith('xl/') ? target : `xl/${target.replace(/^\/+/, '')}`
    targets.set(name, path)
  }
  return targets
}

export function patchWorkbookCells(bytes: Uint8Array, patches: CellPatch[]): Uint8Array {
  const files = unzipSync(bytes)
  const targets = sheetTargets(bytes)
  const bySheet = new Map<string, CellPatch[]>()
  for (const patch of patches) {
    const list = bySheet.get(patch.sheet) ?? []
    list.push(patch)
    bySheet.set(patch.sheet, list)
  }
  for (const [sheet, list] of bySheet) {
    const path = targets.get(sheet)
    const file = path ? files[path] : undefined
    if (!path || !file) throw new Error(`工作表不存在：${sheet}`)
    files[path] = strToU8(patchSheetXml(strFromU8(file), list))
  }
  return zipSync(files)
}

export function writeFormulaCache(bytes: Uint8Array, values: Record<string, CellData>): Uint8Array {
  const cells = readXlsxCells(bytes)
  const files = unzipSync(bytes)
  const targets = sheetTargets(bytes)
  const bySheet = new Map<string, Array<{ address: string; value: CellScalar }>>()
  for (const cell of cells) {
    if (!cell.formula) continue
    const value = values[cellRef(cell.sheet, cell.address)]
    if (value === undefined || (typeof value === 'object' && value !== null)) continue
    const list = bySheet.get(cell.sheet) ?? []
    list.push({ address: cell.address, value })
    bySheet.set(cell.sheet, list)
  }
  for (const [sheet, list] of bySheet) {
    const path = targets.get(sheet)
    const file = path ? files[path] : undefined
    if (!path || !file) continue
    files[path] = strToU8(writeCacheXml(strFromU8(file), list))
  }
  return zipSync(files)
}

export function chartPartNames(bytes: Uint8Array): string[] {
  return Object.keys(unzipSync(bytes)).filter(name => /\/charts?\/chart\d+\.xml$/.test(name) || /\/chart\d+\.xml$/.test(name)).sort()
}

function patchSheetXml(xml: string, patches: CellPatch[]): string {
  const pending = new Map(patches.map(patch => [patch.address.toUpperCase(), patch.value]))
  const replaced = xml.replace(cellPattern(), (full, prefix: string, before: string, address: string, after: string, tail: string, inner: string | undefined) => {
    const value = pending.get(address.toUpperCase())
    if (value === undefined) return full
    if (inner && /<(?:[\w.-]+:)?f\b/.test(inner)) return full
    pending.delete(address.toUpperCase())
    return literalCell(prefix, `${before} ${after}`, address, value)
  })
  return replaced
}

function writeCacheXml(xml: string, updates: Array<{ address: string; value: CellScalar }>): string {
  const pending = new Map(updates.map(item => [item.address.toUpperCase(), item.value]))
  return xml.replace(cellPattern(), (full, prefix: string, before: string, address: string, after: string, tail: string, inner: string | undefined) => {
    const value = pending.get(address.toUpperCase())
    if (value === undefined || !inner || !/<(?:[\w.-]+:)?f\b/.test(inner)) return full
    const formula = /<(?:[\w.-]+:)?f\b[\s\S]*?<\/(?:[\w.-]+:)?f>/.exec(inner)?.[0] ?? ''
    const shown = typeof value === 'number' ? numericText(value) : escapeXml(String(value))
    const type = typeof value === 'number' ? 'n' : 'str'
    const attrs = stripType(`${before} ${after}`).replace(/\s+r="[^"]*"/g, '').replace(/\s+$/, '')
    return `<${prefix}c r="${address}"${attrs} t="${type}">${formula}<${prefix}v>${shown}</${prefix}v></${prefix}c>`
  })
}

function cellPattern(): RegExp {
  return /<((?:[\w.-]+:)?)c\b([^>]*?)\br="([A-Za-z]+\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/\1c>)/g
}

function literalCell(prefix: string, attrs: string, address: string, value: CellScalar): string {
  const cleaned = stripType(attrs).replace(/\s+r="[^"]*"/g, '')
  if (value === null) return `<${prefix}c r="${address}"${cleaned}/>`
  if (typeof value === 'number') return `<${prefix}c r="${address}"${cleaned} t="n"><${prefix}v>${numericText(value)}</${prefix}v></${prefix}c>`
  if (typeof value === 'boolean') return `<${prefix}c r="${address}"${cleaned} t="b"><${prefix}v>${value ? 1 : 0}</${prefix}v></${prefix}c>`
  return `<${prefix}c r="${address}"${cleaned} t="inlineStr"><${prefix}is><${prefix}t>${escapeXml(value)}</${prefix}t></${prefix}is></${prefix}c>`
}

function stripType(attrs: string): string {
  return attrs.replace(/\s+t="[^"]*"/g, '').replace(/\s+/g, ' ').replace(/\s+$/, '')
}

function numericText(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(value)
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
