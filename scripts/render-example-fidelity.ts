/**
 * Render every converted ppt-master example page and compare it with the source SVG.
 *
 *   bun scripts/render-example-fidelity.ts
 *
 * Writes a numbered cover sheet and ten side-by-side comparisons under /opt/cursor/artifacts.
 * The remaining page comparisons and the numeric report go into a zip there.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportDeck } from '../apps/electron/resources/skills/ppt-design/engine/export-pptx.ts'
import { parseDeckSource } from '../apps/electron/resources/skills/ppt-design/engine/schema.ts'
import type { Deck } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

const sharp = createRequire('/workspace/package.json')('sharp') as typeof import('sharp')
const skill = 'apps/electron/resources/skills/ppt-design'
const exampleRoot = '/tmp/ppt-master-examples/examples'
const outDir = '/opt/cursor/artifacts'
const work = join(tmpdir(), 'pm-fidelity')
const fonts = join(tmpdir(), 'pm-fid-fonts.conf')

const PAIRS: Array<[string, string]> = [
  ['ppt169_night_shelf_creative_pitch', '01-night-shelf'],
  ['ppt169_how_color_works_workshop', '02-color-workshop'],
  ['ppt169_qianli_jiangshan_scroll', '03-qianli'],
  ['custom_1920x600_autumn_web_banner', '04-autumn-banner'],
  ['a4_four_day_week_decision_memo', '05-four-day-week'],
  ['moments_midautumn_moon_quick', '06-midautumn'],
  ['story_art_of_war_reading_cards', '07-art-of-war'],
  ['xiaohongshu_first_aid_kit_zh', '08-first-aid'],
  ['ppt169_swiss_grid_systems', '09-swiss-grid'],
  ['ppt43_sleep_science_explainer', '10-sleep-science'],
]

type Project = { id: string; title: string; slides: Array<{ file: string }> }
type PageScore = { id: string; page: number; file: string; mean: number; hot: number }

writeFileSync(fonts, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <alias binding="strong"><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="strong"><family>Segoe UI</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="strong"><family>Trebuchet MS</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="strong"><family>Georgia</family><prefer><family>Liberation Serif</family></prefer></alias>
  <alias binding="strong"><family>Times New Roman</family><prefer><family>Liberation Serif</family></prefer></alias>
  <alias binding="strong"><family>Consolas</family><prefer><family>Liberation Mono</family></prefer></alias>
  <alias binding="strong"><family>PingFang SC</family><prefer><family>Noto Sans CJK SC</family></prefer></alias>
  <alias binding="strong"><family>Microsoft YaHei</family><prefer><family>Noto Sans CJK SC</family></prefer></alias>
  <alias binding="strong"><family>Songti SC</family><prefer><family>Noto Serif CJK SC</family></prefer></alias>
  <alias binding="strong"><family>SimSun</family><prefer><family>Noto Serif CJK SC</family></prefer></alias>
  <alias binding="strong"><family>KaiTi</family><prefer><family>Noto Serif CJK SC</family></prefer></alias>
  <alias binding="strong"><family>Kaiti SC</family><prefer><family>Noto Serif CJK SC</family></prefer></alias>
</fontconfig>
`)

function run(command: string, args: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env: { ...process.env, FONTCONFIG_FILE: fonts } })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stderr })
    })
  })
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function meanDiff(origin: string, ours: string): Promise<{ mean: number; hot: number }> {
  const width = 360
  const a = await sharp(origin).resize(width).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(ours).resize(width).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = Math.min(a.info.width, b.info.width)
  const h = Math.min(a.info.height, b.info.height)
  let sum = 0
  let hot = 0
  let n = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const ia = (y * a.info.width + x) * 3
      const ib = (y * b.info.width + x) * 3
      const d = (Math.abs(a.data[ia]! - b.data[ib]!) + Math.abs(a.data[ia + 1]! - b.data[ib + 1]!) + Math.abs(a.data[ia + 2]! - b.data[ib + 2]!)) / 3
      sum += d
      if (d > 40) hot += 1
      n += 1
    }
  }
  return { mean: n ? sum / n : 0, hot: n ? hot / n : 0 }
}

async function sideBySide(origin: string, ours: string, title: string, file: string): Promise<void> {
  const height = 420
  const left = await sharp(origin).resize({ height, fit: 'inside' }).png().toBuffer({ resolveWithObject: true })
  const right = await sharp(ours).resize({ height, fit: 'inside' }).png().toBuffer({ resolveWithObject: true })
  const gap = 16
  const head = 44
  const width = left.info.width + right.info.width + gap * 3
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${head}"><rect width="100%" height="100%" fill="#161616"/><text x="16" y="28" fill="#f4f1ea" font-family="Noto Sans CJK SC, sans-serif" font-size="18">${escapeXml(title)}</text></svg>`)
  await sharp({ create: { width, height: head + height + 16, channels: 3, background: '#161616' } })
    .composite([
      { input: label, left: 0, top: 0 },
      { input: left.data, left: gap, top: head },
      { input: right.data, left: gap * 2 + left.info.width, top: head },
    ])
    .png()
    .toFile(file)
}

async function renderDeck(id: string, deck: Deck, dir: string): Promise<string[]> {
  const pptx = join(dir, 'deck.pptx')
  const exported = await exportDeck(deck, pptx, { platform: 'linux' })
  if (exported.status !== 'ok') throw new Error(exported.issues.map(item => item.message).join('; '))
  const profile = mkdtempSync(join(tmpdir(), 'pm-lo-'))
  const converted = await run('soffice', [
    '--headless', '--norestore', '--nolockcheck',
    `-env:UserInstallation=file://${profile}`,
    '--convert-to', 'pdf', '--outdir', dir, pptx,
  ])
  rmSync(profile, { recursive: true, force: true })
  if (converted.code !== 0) throw new Error(converted.stderr.slice(0, 500))
  const popped = await run('pdftoppm', ['-png', '-r', '72', join(dir, 'deck.pdf'), join(dir, 'slide')])
  if (popped.code !== 0) throw new Error(popped.stderr.slice(0, 400))
  return readdirSync(dir).filter(name => name.startsWith('slide-') && name.endsWith('.png')).sort()
    .map(name => join(dir, name))
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(skill, 'styles/examples/manifest.json'), 'utf8')) as {
    excluded: Array<{ id: string; reason: string }>
  }
  const excluded = new Map(manifest.excluded.map(item => [item.id, item.reason]))
  const projects = (JSON.parse(readFileSync(join(exampleRoot, 'examples.json'), 'utf8')) as { projects: Project[] }).projects
  const scores: PageScore[] = []
  const covers: Array<{ label: string; png?: Buffer; excluded?: string }> = []
  const pairNames = new Map(PAIRS)
  const zipDir = join(work, 'zip')
  mkdirSync(zipDir, { recursive: true })

  for (let index = 0; index < projects.length; index++) {
    const project = projects[index]!
    const label = `E${String(index + 1).padStart(2, '0')} ${project.title}`
    const reason = excluded.get(project.id)
    if (reason) {
      covers.push({ label, excluded: reason })
      console.log(`skip ${project.id}`)
      continue
    }
    const deckFile = join(skill, 'styles/examples', project.id, 'deck.json')
    const parsed = parseDeckSource(readFileSync(deckFile, 'utf8'))
    if (!parsed.deck) throw new Error(`${project.id} 无法解析`)
    const dir = join(work, project.id)
    mkdirSync(dir, { recursive: true })
    let slides: string[] = []
    try {
      slides = await renderDeck(project.id, parsed.deck, dir)
    } catch (error) {
      console.log(`render-fail ${project.id} ${error instanceof Error ? error.message : error}`)
      covers.push({ label, excluded: '渲染失败' })
      continue
    }
    const svgDir = join(exampleRoot, project.id, 'svg_final')
    const files = project.slides.map(slide => slide.file).filter(file => file.endsWith('.svg'))
    const pageCount = Math.min(slides.length, files.length, parsed.deck.pages.length)
    for (let page = 0; page < pageCount; page++) {
      const svg = join(svgDir, files[page]!)
      const reference = join(dir, `ref-${page + 1}.png`)
      const meta = await sharp(slides[page]!).metadata()
      const drawn = await run('rsvg-convert', ['-w', String(meta.width ?? 960), '-h', String(meta.height ?? 540), '-o', reference, svg])
      if (drawn.code !== 0) {
        scores.push({ id: project.id, page: page + 1, file: files[page]!, mean: 999, hot: 1 })
        continue
      }
      const diff = await meanDiff(reference, slides[page]!)
      scores.push({ id: project.id, page: page + 1, file: files[page]!, mean: Number(diff.mean.toFixed(2)), hot: Number(diff.hot.toFixed(3)) })
      const pair = pairNames.get(project.id)
      if (pair && (page === 0 || page === Math.min(2, pageCount - 1))) {
        const name = page === 0 ? `compare-${pair}.png` : `compare-${pair}-p${page + 1}.png`
        const target = page === 0 ? join(outDir, name) : join(zipDir, name)
        await sideBySide(reference, slides[page]!, `${label} · 第 ${page + 1} 页 · 左为原 SVG，右为 selection-deck`, target)
      }
    }
    const thumb = await sharp(slides[0]!).resize(200, 120, { fit: 'contain', background: '#111111' }).png().toBuffer()
    covers.push({ label, png: thumb })
    console.log(`${project.id} pages=${pageCount} mean=${(scores.filter(item => item.id === project.id).reduce((sum, item) => sum + item.mean, 0) / pageCount).toFixed(1)}`)
    rmSync(dir, { recursive: true, force: true })
  }

  await overview(covers, join(outDir, 'examples-overview.png'))
  scores.sort((a, b) => b.mean - a.mean)
  const summary = {
    pages: scores.length,
    mean: Number((scores.reduce((sum, item) => sum + item.mean, 0) / Math.max(1, scores.length)).toFixed(2)),
    hotShare: Number((scores.reduce((sum, item) => sum + item.hot, 0) / Math.max(1, scores.length)).toFixed(3)),
    worst: scores.slice(0, 25),
  }
  writeFileSync(join(zipDir, 'fidelity-report.json'), JSON.stringify(summary, null, 2))
  writeFileSync(join(outDir, 'examples-fidelity-report.json'), JSON.stringify(summary, null, 2))
  const zipped = await run('zip', ['-r', join(outDir, 'examples-fidelity-rest.zip'), '.'], zipDir)
  if (zipped.code !== 0) throw new Error(zipped.stderr)
  console.log(JSON.stringify(summary.worst.slice(0, 8)))
  console.log(`mean ${summary.mean} pages ${summary.pages}`)
}

async function overview(covers: Array<{ label: string; png?: Buffer; excluded?: string }>, file: string): Promise<void> {
  const cols = 10
  const cellW = 212
  const cellH = 176
  const gap = 8
  const rows = Math.ceil(covers.length / cols)
  const width = gap + cols * (cellW + gap)
  const height = gap + rows * (cellH + gap)
  const composites: { input: Buffer; left: number; top: number }[] = []
  for (let index = 0; index < covers.length; index++) {
    const cover = covers[index]!
    const col = index % cols
    const row = Math.floor(index / cols)
    const x = gap + col * (cellW + gap)
    const y = gap + row * (cellH + gap)
    const caption = escapeXml(cover.label.length > 28 ? `${cover.label.slice(0, 27)}…` : cover.label)
    const note = cover.excluded ? escapeXml(cover.excluded.length > 22 ? `${cover.excluded.slice(0, 21)}…` : cover.excluded) : ''
    const card = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${cellH}"><rect width="100%" height="100%" fill="${cover.excluded ? '#3a2424' : '#1b1b1b'}"/><text x="8" y="164" fill="#f4f1ea" font-family="Noto Sans CJK SC, sans-serif" font-size="11">${caption}</text>${note ? `<text x="8" y="148" fill="#e7b4a8" font-family="Noto Sans CJK SC, sans-serif" font-size="11">${note}</text>` : ''}</svg>`)
    composites.push({ input: card, left: x, top: y })
    if (cover.png) composites.push({ input: cover.png, left: x + 6, top: y + 6 })
  }
  await sharp({ create: { width, height, channels: 3, background: '#0e0e0e' } }).composite(composites).png().toFile(file)
}

await main()
