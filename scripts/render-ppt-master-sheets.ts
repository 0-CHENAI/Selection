/**
 * Render contact sheets for the ppt-master layouts, styles, and themes.
 * Uses the local LibreOffice already on the machine. Does not install one.
 *
 *   bun scripts/render-ppt-master-sheets.ts
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDeck } from '../apps/electron/resources/skills/ppt-design/engine/check.ts'
import { exportDeck } from '../apps/electron/resources/skills/ppt-design/engine/export-pptx.ts'
import { parseDeckSource } from '../apps/electron/resources/skills/ppt-design/engine/schema.ts'
import { colorRef } from '../apps/electron/resources/skills/ppt-design/engine/schema.ts'
import type { Deck, DeckElement, DeckPage, Theme } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

const sharp = createRequire('/workspace/package.json')('sharp') as typeof import('sharp')
const skill = 'apps/electron/resources/skills/ppt-design'
const outDir = '/opt/cursor/artifacts'
const fonts = join(tmpdir(), 'pm-fonts.conf')

writeFileSync(fonts, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <alias binding="strong"><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="strong"><family>Georgia</family><prefer><family>Liberation Serif</family></prefer></alias>
  <alias binding="strong"><family>PingFang SC</family><prefer><family>Noto Sans CJK SC</family></prefer></alias>
  <alias binding="strong"><family>Microsoft YaHei</family><prefer><family>Noto Sans CJK SC</family></prefer></alias>
  <alias binding="strong"><family>Songti SC</family><prefer><family>Noto Serif CJK SC</family></prefer></alias>
  <alias binding="strong"><family>SimSun</family><prefer><family>Noto Serif CJK SC</family></prefer></alias>
</fontconfig>
`)

type Job = { id: string; file: string; deck: Deck; cols: number; thumb: number }

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const jobs: Job[] = []
  const styleCatalog = JSON.parse(readFileSync(join(skill, 'styles/catalog.json'), 'utf8')) as Record<string, { deck?: string }>
  const styleIds = [
    'academic-research', 'consulting-decision', 'creative-pitch', 'duty-manual', 'incident-postmortem',
    'investor-pitch', 'mbb-consulting', 'narrative-keynote', 'operating-review', 'product-launch',
    'science-explainer', 'solution-proposal', 'technical-deepdive', 'workshop-teaching',
  ]
  for (const id of styleIds) {
    const relative = styleCatalog[id]?.deck
    if (!relative) continue
    const file = join(skill, relative)
    jobs.push({ id: `pm-style-${id}`, file, deck: load(file), cols: 4, thumb: 240 })
  }
  const layouts = Object.keys(JSON.parse(readFileSync(join(skill, 'layouts/catalog.json'), 'utf8')))
  for (const id of layouts) {
    const deck = load(join(skill, 'layouts', id, 'deck.json'))
    const cols = deck.pages.length > 16 ? 5 : deck.pages.length > 12 ? 4 : deck.pages.length > 8 ? 4 : 4
    const thumb = deck.canvas.height > deck.canvas.width ? 180 : 280
    jobs.push({ id: `pm-layout-${id}`, file: join(skill, 'layouts', id, 'deck.json'), deck, cols, thumb })
  }
  const themeDeck = themeShowcase()
  jobs.push({ id: 'pm-themes', file: '', deck: themeDeck, cols: 4, thumb: 300 })

  const covers: { label: string; png: string; group: string }[] = []
  for (const job of jobs) {
    const slides = await renderDeck(job)
    const labels = job.deck.pages.map((page, index) => `${String(index + 1).padStart(2, '0')} ${page.name ?? page.layout}`)
    const sheet = join(outDir, `${job.id}.png`)
    await contact(slides, labels, job.cols, job.thumb, sheet, job.id)
    console.log(sheet)
    if (job.id.startsWith('pm-style-')) covers.push({ label: job.id.replace('pm-style-', '').replace('-12p', ''), png: slides[0]!, group: '风格' })
    if (job.id.startsWith('pm-layout-')) covers.push({ label: job.id.replace('pm-layout-', ''), png: slides[0]!, group: '版式' })
    if (job.id === 'pm-themes') {
      slides.forEach((png, index) => covers.push({ label: themeDeck.pages[index]!.name ?? '', png, group: '主题' }))
    }
  }
  await overview(covers, join(outDir, 'pm-overview.png'))
  console.log(join(outDir, 'pm-overview.png'))
}

function load(file: string): Deck {
  const parsed = parseDeckSource(readFileSync(file, 'utf8'))
  if (!parsed.deck || parsed.issues.length) throw new Error(`${file} 无法解析`)
  return parsed.deck
}

function themeShowcase(): Deck {
  const base = load(join(skill, 'layouts/editorial_bleed/deck.json'))
  const source = base.pages[2]!
  const catalog = JSON.parse(readFileSync(join(skill, 'styles/themes/catalog.json'), 'utf8')) as Record<string, { file: string; name: string }>
  const pages = Object.values(catalog).map(entry => {
    const theme = JSON.parse(readFileSync(join(skill, entry.file), 'utf8')) as Theme
    return bake(source, theme, entry.name)
  })
  const deck: Deck = { ...base, title: '主题', theme: JSON.parse(readFileSync(join(skill, Object.values(catalog)[0]!.file), 'utf8')) as Theme, pages }
  const issues = checkDeck(deck)
  if (issues.length) {
    console.error(issues.slice(0, 8))
    throw new Error('主题页预检未通过')
  }
  return deck
}

function bake(page: DeckPage, theme: Theme, name: string): DeckPage {
  const paint = (value: string | undefined) => value ? colorRef(value, theme, '#FFFFFF') : value
  const mapElement = (element: DeckElement): DeckElement => ({
    ...element,
    fill: paint(element.fill),
    font: element.font ? { ...element.font, color: paint(element.font.color) } : undefined,
    line: element.line ? { ...element.line, color: paint(element.line.color) ?? element.line.color } : undefined,
  })
  return {
    ...page,
    id: theme.id,
    layout: theme.id,
    name,
    background: paint(page.background) ?? '#FFFFFF',
    elements: page.elements.map(mapElement),
  }
}

async function renderDeck(job: Job): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'pm-sheet-'))
  const pptx = join(dir, 'deck.pptx')
  const exported = await exportDeck(job.deck, pptx, { platform: 'linux' })
  if (exported.status !== 'ok') throw new Error(`${job.id} 导出失败 ${exported.issues?.map(item => item.message).join('; ')}`)
  const profile = mkdtempSync(join(tmpdir(), 'pm-lo-'))
  const converted = await run('soffice', [
    '--headless', '--norestore', '--nolockcheck',
    `-env:UserInstallation=file://${profile}`,
    '--convert-to', 'pdf', '--outdir', dir, pptx,
  ])
  rmSync(profile, { recursive: true, force: true })
  if (converted.code !== 0) throw new Error(`${job.id} LibreOffice 失败\n${converted.stderr}`)
  const popped = await run('pdftoppm', ['-png', '-r', '72', join(dir, 'deck.pdf'), join(dir, 'slide')])
  if (popped.code !== 0) throw new Error(`${job.id} pdftoppm 失败\n${popped.stderr}`)
  const files = Array.from({ length: job.deck.pages.length }, (_, index) => join(dir, `slide-${String(index + 1).padStart(job.deck.pages.length >= 10 ? 2 : 1, '0')}.png`))
  const { existsSync, readdirSync } = await import('node:fs')
  if (!existsSync(files[0]!)) {
    const found = readdirSync(dir).filter(name => name.endsWith('.png')).sort()
    if (found.length < job.deck.pages.length) throw new Error(`${job.id} 只有 ${found.length} 张图：${found.join(',')}`)
    return found.map(name => join(dir, name))
  }
  return files
}

async function contact(files: string[], labels: string[], cols: number, thumb: number, file: string, title: string): Promise<void> {
  const tiles = []
  for (const png of files) {
    const meta = await sharp(png).metadata()
    const height = Math.round(thumb * ((meta.height ?? 1) / (meta.width ?? 1)))
    tiles.push({ png: await sharp(png).resize(thumb, height).png().toBuffer(), height })
  }
  const rowH = Math.max(...tiles.map(tile => tile.height))
  const labelH = 32
  const gap = 16
  const pad = 28
  const rows = Math.ceil(tiles.length / cols)
  const width = pad * 2 + cols * thumb + (cols - 1) * gap
  const height = 64 + pad + rows * (labelH + rowH) + (rows - 1) * gap + pad
  const layers: { input: Buffer; left: number; top: number }[] = [svg(width, 64, title, 28, 40)]
  tiles.forEach((tile, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const x = pad + col * (thumb + gap)
    const y = 64 + pad + row * (labelH + rowH + gap)
    layers.push(svg(thumb, labelH, labels[index] ?? '', 16, 22))
    layers[layers.length - 1] = { ...layers[layers.length - 1]!, left: x, top: y }
    layers.push({ input: tile.png, left: x, top: y + labelH })
  })
  // The push above assigned left/top incorrectly for the svg helper return. Rebuild cleanly.
  const composites: { input: Buffer; left: number; top: number }[] = [{ input: textSvg(width, 64, title, 28, 42), left: 0, top: 0 }]
  tiles.forEach((tile, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const x = pad + col * (thumb + gap)
    const y = 64 + pad + row * (labelH + rowH + gap)
    composites.push({ input: textSvg(thumb, labelH, fitLabel(labels[index] ?? '', thumb, 15), 15, 22), left: x, top: y })
    composites.push({ input: tile.png, left: x, top: y + labelH })
  })
  await sharp({ create: { width, height, channels: 3, background: '#1c1c1c' } }).composite(composites).png().toFile(file)
  void layers
}

function svg(width: number, height: number, text: string, size: number, y: number): { input: Buffer; left: number; top: number } {
  return { input: textSvg(width, height, text, size, y), left: 0, top: 0 }
}

function textSvg(width: number, height: number, text: string, size: number, y: number): Buffer {
  const body = escapeXml(text)
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="0" y="${y}" fill="#f3f3f3" font-family="Noto Sans CJK SC, Noto Sans CJK JP, sans-serif" font-size="${size}">${body}</text></svg>`)
}

async function overview(items: { label: string; png: string; group: string }[], file: string): Promise<void> {
  const groups = ['风格', '版式', '主题']
  const thumb = 220
  const gap = 14
  const pad = 28
  const cols = 7
  const tiles: { input: Buffer; left: number; top: number }[] = [{ input: textSvg(1800, 64, 'ppt-master 版式、风格与自有主题', 28, 42), left: 28, top: 8 }]
  let y = 80
  let width = 1800
  for (const group of groups) {
    const rows = items.filter(item => item.group === group)
    tiles.push({ input: textSvg(400, 36, group, 20, 26), left: pad, top: y })
    y += 42
    const prepared = []
    for (const item of rows) {
      const meta = await sharp(item.png).metadata()
      const h = Math.round(thumb * ((meta.height ?? 1) / (meta.width ?? 1)))
      prepared.push({ item, h, buf: await sharp(item.png).resize(thumb, h).png().toBuffer() })
    }
    for (let start = 0; start < prepared.length; start += cols) {
      const row = prepared.slice(start, start + cols)
      const rowH = Math.max(...row.map(tile => tile.h))
      row.forEach((tile, col) => {
        const x = pad + col * (thumb + gap)
        tiles.push({ input: textSvg(thumb, 26, fitLabel(tile.item.label, thumb, 13), 13, 18), left: x, top: y })
        tiles.push({ input: tile.buf, left: x, top: y + 26 + Math.round((rowH - tile.h) / 2) })
        width = Math.max(width, x + thumb + pad)
      })
      y += 26 + rowH + gap
    }
    y += 16
  }
  await sharp({ create: { width, height: y + 12, channels: 3, background: '#1c1c1c' } }).composite(tiles).png().toFile(file)
}

function fitLabel(text: string, width: number, size: number): string {
  const max = Math.max(8, width - 8)
  let used = 0
  let out = ''
  for (const ch of text) {
    const advance = /[\u3400-\u9fff]/.test(ch) ? size : size * 0.56
    if (used + advance > max) return `${out.trimEnd()}…`
    out += ch
    used += advance
  }
  return out
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { env: { ...process.env, FONTCONFIG_FILE: fonts } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

await main()
