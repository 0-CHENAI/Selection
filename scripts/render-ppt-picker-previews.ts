/** Generate bundled picker pages from complete real selection-deck exports.
 * bun scripts/render-ppt-picker-previews.ts [--force] [--templates=id1,id2]
 * Pipeline: selection-deck export → LibreOffice vector PDF (detail) → 480px WebP (catalog).
 * Full ordered pages live in styles/previews/pages. The first three card covers are
 * rewritten from those pages whenever a deck is rendered. Shared preview IDs render once.
 * Requires LibreOffice and pdftoppm on PATH; WebP encoding uses the workspace sharp dependency. No mockup assets are used.
 *
 * Card covers for the later DSH packs went tofu (empty .notdef boxes) because this
 * script did not alias CJK faces. Those decks name PingFang SC / Microsoft YaHei /
 * Noto Sans CJK SC / Noto Serif CJK SC, and some titles set face.cjk.linux to
 * Noto Serif CJK SC. LibreOffice then draws Latin (Arial, Arial Black) and leaves
 * Chinese as hollow boxes. A later page render kept the good PDF and page WebP,
 * but the old script refused to replace an existing styles/previews/<id>-1..3.webp,
 * so the bad covers stayed. FONTCONFIG_FILE below maps those faces onto an
 * installed CJK family before soffice and pdftoppm run.
 */
import sharp from 'sharp'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { exportDeck, platformFromProcess } from '../apps/electron/resources/skills/ppt-design/engine/export-pptx.ts'
import type { Deck } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

const root = resolve(import.meta.dir, '../apps/electron/resources/skills/ppt-design')
const catalog = JSON.parse(readFileSync(join(root, 'styles/catalog.json'), 'utf8')) as Record<string, { deck: string }>
const picker = JSON.parse(readFileSync(join(root, 'styles/picker.json'), 'utf8')) as { aliases?: Record<string, string>; templates: Record<string, { previewId: string; tier?: string }> }
const output = join(root, 'styles/previews')
mkdirSync(output, { recursive: true })
const pagesOutput = join(output, 'pages')
mkdirSync(pagesOutput, { recursive: true })
const documentsOutput = join(output, 'documents')
mkdirSync(documentsOutput, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'selection-picker-'))
const fonts = join(work, 'fonts.conf')
const cjk = 'Noto Sans CJK SC'
writeFileSync(fonts, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <alias binding="strong"><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="strong"><family>Arial Black</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="strong"><family>PingFang SC</family><prefer><family>${cjk}</family></prefer></alias>
  <alias binding="strong"><family>Microsoft YaHei</family><prefer><family>${cjk}</family></prefer></alias>
  <alias binding="strong"><family>Hiragino Sans GB</family><prefer><family>${cjk}</family></prefer></alias>
  <alias binding="strong"><family>HarmonyOS Sans SC</family><prefer><family>${cjk}</family></prefer></alias>
  <alias binding="strong"><family>Source Han Sans SC</family><prefer><family>${cjk}</family></prefer></alias>
  <alias binding="strong"><family>Noto Sans CJK SC</family><prefer><family>Noto Sans CJK SC</family><family>WenQuanYi Micro Hei</family><family>Droid Sans Fallback</family></prefer></alias>
  <alias binding="strong"><family>Noto Serif CJK SC</family><prefer><family>Noto Serif CJK SC</family><family>${cjk}</family><family>WenQuanYi Micro Hei</family></prefer></alias>
  <alias binding="strong"><family>Songti SC</family><prefer><family>Noto Serif CJK SC</family><family>WenQuanYi Micro Hei</family></prefer></alias>
  <alias binding="strong"><family>SimSun</family><prefer><family>Noto Serif CJK SC</family><family>WenQuanYi Micro Hei</family></prefer></alias>
</fontconfig>
`)
async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'ignore', stderr: 'pipe', env: { ...process.env, FONTCONFIG_FILE: fonts } })
  const stderr = await new Response(child.stderr).text()
  if (await child.exited) throw new Error(`${args[0]}: ${stderr}`)
}
try {
  const rendered = new Set<string>()
  const selection = process.argv.find(arg => arg.startsWith('--templates='))?.slice('--templates='.length).split(',')
  for (const [id, entry] of Object.entries(catalog)) {
    if (selection && !selection.includes(id)) continue
    const meta = picker.templates[id] ?? picker.templates[picker.aliases?.[id] ?? '']
    if (!meta || meta.tier === 'archive') continue
    const previewId = meta.previewId
    if (rendered.has(previewId)) continue
    rendered.add(previewId)
    const deck = JSON.parse(readFileSync(join(root, entry.deck), 'utf8')) as Deck
    const pagesReady = existsSync(join(documentsOutput, `${previewId}.pdf`)) && deck.pages.every((_, index) => existsSync(join(pagesOutput, `${previewId}-${index + 1}.webp`)))
    if (!process.argv.includes('--force') && pagesReady) {
      for (let page = 1; page <= Math.min(3, deck.pages.length); page++) {
        await Bun.write(join(output, `${previewId}-${page}.webp`), Bun.file(join(pagesOutput, `${previewId}-${page}.webp`)))
      }
      continue
    }
    const pptx = join(work, `${previewId}.pptx`)
    await exportDeck(deck, pptx, { enforceCheck: false, platform: platformFromProcess() })
    await run(['soffice', '--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=file://${join(work, 'office-profile')}`, '--convert-to', 'pdf', '--outdir', work, pptx])
    const pdf = Bun.file(join(work, `${previewId}.pdf`))
    // A document travels in one RPC message. Do not ship an asset that the WebUI cannot open.
    if (pdf.size * 4 / 3 + 1024 >= 16 * 1024 * 1024) throw new Error(`Preview PDF exceeds transport limit: ${previewId}`)
    await Bun.write(join(documentsOutput, `${previewId}.pdf`), pdf)
    const prefix = join(work, previewId)
    await run(['pdftoppm', '-f', '1', '-l', String(deck.pages.length), '-scale-to', '480', '-png', join(dirname(pptx), `${previewId}.pdf`), prefix])
    for (let page = 1; page <= deck.pages.length; page++) {
      const digits = String(deck.pages.length).length
      const image = `${prefix}-${String(page).padStart(digits, '0')}.png`
      await sharp(image).webp({ quality: 74 }).toFile(join(pagesOutput, `${previewId}-${page}.webp`))
      // Card covers are the same raster as the full page. Do not keep an older
      // file: that is how tofu covers survived a later, correctly fonted render.
      if (page <= 3) await Bun.write(join(output, `${previewId}-${page}.webp`), Bun.file(join(pagesOutput, `${previewId}-${page}.webp`)))
    }
    console.log(previewId)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
