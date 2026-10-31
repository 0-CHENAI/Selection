/**
 * Excel 页面设置样例扩展：缩放为 1 页宽、A3、设打印区域。
 * 只作用于工作副本；案例原件不变。已有打印区域的工作表不改（bio-assay / port-cargo 明细表的 45 行打印区域按 LinNai 2026-10-31 决定保留）。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { sheetTargets } from './workbook.ts'

export interface PageSetupExtension {
  paperSize: number
  orientation: 'portrait' | 'landscape'
  fitToWidth: number
  fitToHeight: number
  printArea: 'used-range'
}

export interface SheetPrintSetup { sheet: string; printArea?: string; paperSize?: string; fitToWidth?: string; fitToHeight?: string; fitToPage: boolean }

function escapeName(sheet: string): string {
  return `'${sheet.replaceAll("'", "''")}'`
}

function columnName(index: number): string {
  let name = ''
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

function columnIndex(name: string): number {
  return [...name.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0)
}

function usedRange(xml: string): string {
  let maxRow = 1
  let maxCol = 1
  for (const match of xml.matchAll(/<(?:\w+:)?c\b[^>]*\br="([A-Z]+)(\d+)"/g)) {
    maxCol = Math.max(maxCol, columnIndex(match[1]!))
    maxRow = Math.max(maxRow, Number(match[2]))
  }
  for (const match of xml.matchAll(/<(?:\w+:)?col\b[^>]*\bmax="(\d+)"/g)) maxCol = Math.max(maxCol, Number(match[1]))
  return `$A$1:$${columnName(maxCol)}$${maxRow}`
}

/** 已存在的打印区域：localSheetId → 定义。 */
function existingPrintAreas(workbook: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const match of workbook.matchAll(/<(?:\w+:)?definedName\b([^>]*)>([^<]*)<\/(?:\w+:)?definedName>/g)) {
    if (!/name="_xlnm\.Print_Area"/.test(match[1]!)) continue
    const id = /localSheetId="(\d+)"/.exec(match[1]!)?.[1]
    if (id !== undefined) map.set(Number(id), match[2]!)
  }
  return map
}

export function applyPageSetupExtension(bytes: Uint8Array, extension: PageSetupExtension): Uint8Array {
  const files = unzipSync(bytes)
  let workbook = strFromU8(files['xl/workbook.xml']!)
  const prefix = /<(\w+:)?workbook\b/.exec(workbook)?.[1] ?? ''
  const targets = [...sheetTargets(bytes)]
  const existing = existingPrintAreas(workbook)
  const additions: string[] = []
  targets.forEach(([sheet, path], index) => {
    const file = files[path]
    if (!file) return
    if (existing.has(index)) return
    let xml = strFromU8(file)
    const p = /<(\w+:)?worksheet\b/.exec(xml)?.[1] ?? ''
    additions.push(`<${prefix}definedName name="_xlnm.Print_Area" localSheetId="${index}">${escapeName(sheet).replaceAll('&', '&amp;')}!${usedRange(xml)}</${prefix}definedName>`)
    // sheetPr/pageSetUpPr fitToPage
    if (new RegExp(`<${p}sheetPr\\b[^>]*/>`).test(xml)) xml = xml.replace(new RegExp(`<${p}sheetPr\\b([^>]*)/>`), `<${p}sheetPr$1><${p}pageSetUpPr fitToPage="1"/></${p}sheetPr>`)
    else if (new RegExp(`<${p}sheetPr\\b`).test(xml)) {
      if (new RegExp(`<${p}pageSetUpPr\\b`).test(xml)) xml = xml.replace(new RegExp(`<${p}pageSetUpPr\\b[^>]*/>`), `<${p}pageSetUpPr fitToPage="1"/>`)
      else xml = xml.replace(new RegExp(`</${p}sheetPr>`), `<${p}pageSetUpPr fitToPage="1"/></${p}sheetPr>`)
    } else xml = xml.replace(new RegExp(`(<${p}worksheet\\b[^>]*>)`), `$1<${p}sheetPr><${p}pageSetUpPr fitToPage="1"/></${p}sheetPr>`)
    const setup = `<${p}pageSetup paperSize="${extension.paperSize}" orientation="${extension.orientation}" fitToWidth="${extension.fitToWidth}" fitToHeight="${extension.fitToHeight}"/>`
    xml = xml.replace(new RegExp(`<${p}pageSetup\\b[^>]*/>`), '')
    if (new RegExp(`<${p}pageMargins\\b[^>]*/>`).test(xml)) xml = xml.replace(new RegExp(`(<${p}pageMargins\\b[^>]*/>)`), `$1${setup}`)
    else xml = xml.replace(new RegExp(`(<${p}(?:headerFooter|drawing|legacyDrawing|tableParts|extLst)\\b|</${p}worksheet>)`), `${setup}$1`)
    files[path] = strToU8(xml)
  })
  if (additions.length) {
    if (new RegExp(`<${prefix}definedNames>`).test(workbook)) workbook = workbook.replace(new RegExp(`</${prefix}definedNames>`), `${additions.join('')}</${prefix}definedNames>`)
    else workbook = workbook.replace(new RegExp(`</${prefix}sheets>`), `</${prefix}sheets><${prefix}definedNames>${additions.join('')}</${prefix}definedNames>`)
    files['xl/workbook.xml'] = strToU8(workbook)
  }
  return zipSync(files)
}

export function readPrintSetup(bytes: Uint8Array): SheetPrintSetup[] {
  const files = unzipSync(bytes)
  const workbook = strFromU8(files['xl/workbook.xml']!)
  const areas = existingPrintAreas(workbook)
  return [...sheetTargets(bytes)].map(([sheet, path], index) => {
    const xml = strFromU8(files[path] ?? new Uint8Array())
    const setup = /<(?:\w+:)?pageSetup\b([^>]*)\/>/.exec(xml)?.[1] ?? ''
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(setup)?.[1]
    return { sheet, printArea: areas.get(index), paperSize: attr('paperSize'), fitToWidth: attr('fitToWidth'), fitToHeight: attr('fitToHeight'), fitToPage: /<(?:\w+:)?pageSetUpPr\b[^>]*fitToPage="1"/.test(xml) }
  })
}
