/** Generate bundled picker pages from complete real selection-deck exports.
 * bun scripts/render-ppt-picker-previews.ts [--force]
 * Pipeline: selection-deck export → LibreOffice vector PDF (detail) → 480px WebP (catalog).
 * Full ordered pages live in styles/previews/pages; the original first-three catalog
 * references are retained unchanged. Shared preview IDs render once across aliases.
 * Requires LibreOffice, pdftoppm and ffmpeg on PATH. No mockup assets are used.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { exportDeck } from '../apps/electron/resources/skills/ppt-design/engine/export-pptx.ts'
import type { Deck } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

const root = resolve(import.meta.dir, '../apps/electron/resources/skills/ppt-design')
const catalog = JSON.parse(readFileSync(join(root, 'styles/catalog.json'), 'utf8')) as Record<string, { deck: string }>
const picker = JSON.parse(readFileSync(join(root, 'styles/picker.json'), 'utf8')) as { templates: Record<string, { previewId: string }> }
const output = join(root, 'styles/previews')
mkdirSync(output, { recursive: true })
const pagesOutput = join(output, 'pages')
mkdirSync(pagesOutput, { recursive: true })
const documentsOutput = join(output, 'documents')
mkdirSync(documentsOutput, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'selection-picker-'))
async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'ignore', stderr: 'pipe' })
  const stderr = await new Response(child.stderr).text()
  if (await child.exited) throw new Error(`${args[0]}: ${stderr}`)
}
try {
  const rendered = new Set<string>()
  for (const [id, entry] of Object.entries(catalog)) {
    const previewId = picker.templates[id]!.previewId
    if (rendered.has(previewId)) continue
    rendered.add(previewId)
    const deck = JSON.parse(readFileSync(join(root, entry.deck), 'utf8')) as Deck
    if (!process.argv.includes('--force') && existsSync(join(documentsOutput, `${previewId}.pdf`)) && deck.pages.every((_, index) => existsSync(join(pagesOutput, `${previewId}-${index + 1}.webp`)))) continue
    const pptx = join(work, `${previewId}.pptx`)
    await exportDeck(deck, pptx, { enforceCheck: false, platform: 'linux' })
    await run(['soffice', '--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=file://${join(work, 'office-profile')}`, '--convert-to', 'pdf', '--outdir', work, pptx])
    const pdf = Bun.file(join(work, `${previewId}.pdf`))
    // A document travels in one RPC message. Do not ship an asset that the WebUI cannot open.
    if (pdf.size * 4 / 3 + 1024 >= 16 * 1024 * 1024) throw new Error(`Preview PDF exceeds transport limit: ${previewId}`)
    await Bun.write(join(documentsOutput, `${previewId}.pdf`), pdf)
    // Adding vector details must not rewrite existing lightweight gallery references.
    if (!process.argv.includes('--force') && deck.pages.every((_, index) => existsSync(join(pagesOutput, `${previewId}-${index + 1}.webp`)))) { console.log(previewId); continue }
    const prefix = join(work, previewId)
    await run(['pdftoppm', '-f', '1', '-l', String(deck.pages.length), '-scale-to', '480', '-png', join(dirname(pptx), `${previewId}.pdf`), prefix])
    for (let page = 1; page <= deck.pages.length; page++) {
      const digits = String(deck.pages.length).length
      const image = `${prefix}-${String(page).padStart(digits, '0')}.png`
      await run(['ffmpeg', '-loglevel', 'error', '-y', '-i', image, '-c:v', 'libwebp', '-quality', '74', join(pagesOutput, `${previewId}-${page}.webp`)])
      if (page <= 3 && !existsSync(join(output, `${previewId}-${page}.webp`))) {
        await Bun.write(join(output, `${previewId}-${page}.webp`), Bun.file(join(pagesOutput, `${previewId}-${page}.webp`)))
      }
    }
    console.log(previewId)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
