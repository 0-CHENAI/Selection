import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { checkDeck } from '../check.ts'
import { exportDeck } from '../export-pptx.ts'
import { parseDeckSource } from '../schema.ts'
import type { Deck, DeckIssue, DeckPage } from '../types.ts'
import { previewImportedSlides, type SlidePreviewPort, type SlidePreviewResult } from './preview-port.ts'
import { coverageReport, importPptx, type ImportDiagnostic, type ImportPptxResult } from './pptx-to-deck.ts'
import { mergeRetained, type RetainedManifest } from './retained.ts'

export type ImportProjectResult = {
  deck: Deck | null
  diagnostics: ImportDiagnostic[]
  issues: DeckIssue[]
  preview: SlidePreviewResult
  source: ImportPptxResult['source']
  projectDir: string
}

/** 左右对比：只重排可编辑内容，母版装饰和保留对象留在原坐标。导入页不是论证版式槽，所以 layout 保持 free。 */
export function applySideBySideLayout(page: DeckPage, canvas: { width: number; height: number }): DeckPage {
  const movable = page.elements.filter(element => !element.retained && element.role !== 'decoration')
  const gap = 16
  const margin = 48
  const colW = Math.max(120, (canvas.width - margin * 2 - gap) / 2)
  const columns: DeckElementColumn[] = [[], []]
  movable.forEach((element, index) => columns[index % 2]!.push(element))
  const next = new Map<string, DeckPage['elements'][number]>()
  for (const [columnIndex, column] of columns.entries()) {
    let y = 88
    const x = margin + columnIndex * (colW + gap)
    for (const element of column) {
      next.set(element.id, { ...element, bounds: { ...element.bounds, x, y, w: colW } })
      y += element.bounds.h + gap
    }
  }
  return {
    ...page,
    layout: 'free',
    elements: page.elements.map(element => next.get(element.id) ?? element),
  }
}

type DeckElementColumn = DeckPage['elements']

/**
 * 把工作区里的 PPTX 读成新工程目录。原件只读，不写入模板目录。
 */
export async function importPptxFile(sourcePath: string, outDir: string, options: { maxSlides?: number; preview?: SlidePreviewPort; fileName?: string } = {}): Promise<ImportProjectResult> {
  const source = resolve(sourcePath)
  const projectDir = resolve(outDir)
  assertSafeOutput(source, projectDir)
  const before = statSync(source)
  const bytes = new Uint8Array(readFileSync(source))
  const hash = createHash('sha256').update(bytes).digest('hex')
  const imported = importPptx(bytes, { fileName: options.fileName ?? source.split(/[/\\]/).pop(), maxSlides: options.maxSlides, assetDir: join(projectDir, 'assets') })
  if (statSync(source).mtimeMs !== before.mtimeMs || createHash('sha256').update(readFileSync(source)).digest('hex') !== hash) {
    throw new Error('导入改动了原件')
  }
  mkdirSync(projectDir, { recursive: true })
  const issues = imported.deck ? checkDeck(imported.deck) : []
  const preview = await previewImportedSlides(
    { title: imported.deck?.title ?? imported.source.fileName, pageCount: imported.deck?.pages.length ?? 0, outDir: projectDir },
    options.preview,
  )
  if (imported.deck) writeFileSync(join(projectDir, 'deck.json'), `${JSON.stringify(imported.deck, null, 2)}\n`)
  writeFileSync(join(projectDir, 'diagnostics.json'), `${JSON.stringify({ source: imported.source, preview, ...coverageReport(imported.diagnostics) }, null, 2)}\n`)
  writeFileSync(join(projectDir, 'retained.json'), `${JSON.stringify(imported.retained, null, 2)}\n`)
  return { deck: imported.deck, diagnostics: imported.diagnostics, issues, preview, source: imported.source, projectDir }
}

export async function exportImportedDeck(deck: Deck, outFile: string, manifest?: RetainedManifest): Promise<{ status: string; pptx?: string; issues: DeckIssue[] }> {
  const result = await exportDeck(deck, outFile)
  if (result.pptx && manifest) await mergeRetained(result.pptx, manifest)
  return result
}

export function loadRetained(deckPath: string): RetainedManifest | undefined {
  const file = join(dirname(deckPath), 'retained.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RetainedManifest
    if (parsed?.version !== 1 || !Array.isArray(parsed.slides)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function loadImportedDeck(deckPath: string): Deck {
  const parsed = parseDeckSource(readFileSync(deckPath, 'utf8'))
  if (!parsed.deck) throw new Error(parsed.issues.map(item => item.message).join('；') || '无法读取工程')
  return parsed.deck
}

function assertSafeOutput(source: string, outDir: string): void {
  if (source === outDir) throw new Error('不能把工程写到原件上')
  const prefix = outDir.endsWith(sep) ? outDir : outDir + sep
  if (source.startsWith(prefix)) throw new Error('工程目录不能包住原件')
  if (outDir.includes(`${sep}ppt-design${sep}styles${sep}`) || outDir.includes(`${sep}ppt-templates${sep}`)) {
    throw new Error('不能把导入工程写进模板目录')
  }
}
