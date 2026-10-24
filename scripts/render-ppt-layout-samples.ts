/**
 * Render argument-layout, chart, and custom-template preview samples.
 *
 * Real pages use the bundled OfficeCLI HTML screenshot. The "before" side of
 * each comparison is the geometric SVG the template library used to store,
 * opened in Chrome the same way an <img> would paint it.
 *
 *   bun scripts/render-ppt-layout-samples.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { argumentLayouts, argumentTheme, buildArgumentDeck } from '../apps/electron/resources/skills/ppt-design/engine/argument-layouts.ts'
import { buildChartGalleryDeck, CHART_GALLERY } from '../apps/electron/resources/skills/ppt-design/engine/chart-gallery.ts'
import { checkDeck } from '../apps/electron/resources/skills/ppt-design/engine/check.ts'
import { exportDeck } from '../apps/electron/resources/skills/ppt-design/engine/export-pptx.ts'
import { chart, makeDeck, makePage, panel, text } from '../apps/electron/resources/skills/ppt-design/styles/kit.ts'
import { geometricPptxPreviews } from '../packages/server-core/src/services/ppt-library.ts'
import { resolveOfficecliBinary } from '../packages/shared/src/utils/officecli.ts'
import type { Deck, DeckElement } from '../apps/electron/resources/skills/ppt-design/engine/types.ts'

const OUT = resolve('docs/design/ppt-picker/actual/layouts')
const WIDTH = 1280
const HEIGHT = 720

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
  try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
  try { child.kill('SIGKILL') } catch { /* already gone */ }
}

function officecliBin(): string {
  const fromResolver = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined }, cwd: process.cwd() })
  const candidates = [
    fromResolver,
    resolve('apps/electron/resources/bin/linux-x64/officecli'),
    '/tmp/officecli-dl/officecli',
  ].filter((path): path is string => !!path && existsSync(path) && !/\.(cmd|bat|sh)$/i.test(path))
  const bin = candidates[0]
  if (!bin) throw new Error('找不到 OfficeCLI 可执行文件')
  return bin
}

function officecliScreenshot(bin: string, pptx: string, page: number, outFile: string): void {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { rmSync(outFile) } catch { /* fresh file */ }
    const child = spawn(bin, [
      'view', pptx, 'screenshot',
      '--page', String(page),
      '--render', 'html',
      '--screenshot-width', '1600',
      '--screenshot-height', '900',
      '-o', outFile,
    ], { detached: true, stdio: 'ignore', env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' } })
    const deadline = Date.now() + 20_000
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
    if (ready) return
  }
  throw new Error(`OfficeCLI 没有写出第 ${page} 页：${pptx}`)
}

function chromeScreenshot(htmlPath: string, outFile: string): void {
  const chrome = ['/usr/local/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable'].find(path => existsSync(path))
  if (!chrome) throw new Error('找不到 Chrome，无法栅格化几何 SVG')
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--default-background-color=00000000',
    `--screenshot=${outFile}`,
    `file://${htmlPath}`,
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    if (fileSize(outFile) > 800 && pngMagic(outFile)) break
    sleepSync(100)
  }
  killProcess(child)
  if (!(fileSize(outFile) > 800 && pngMagic(outFile))) throw new Error(`Chrome 没有写出 ${outFile}`)
}

async function fit(input: Buffer | string, width: number, height: number): Promise<Buffer> {
  return sharp(input).resize(width, height, { fit: 'cover', position: 'centre' }).png().toBuffer()
}

async function labeledBoard(left: Buffer, right: Buffer, leftCaption: string, rightCaption: string): Promise<Buffer> {
  const cellW = 960
  const cellH = 540
  const captionH = 56
  const gap = 24
  const pad = 24
  const width = pad * 2 + cellW * 2 + gap
  const height = pad + captionH + cellH + pad
  const [leftPng, rightPng] = await Promise.all([fit(left, cellW, cellH), fit(right, cellW, cellH)])
  const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#F7F7F5"/>
    <text x="${pad}" y="${pad + 34}" font-family="WenQuanYi Micro Hei, Droid Sans Fallback, sans-serif" font-size="22" fill="#141414">${leftCaption}</text>
    <text x="${pad + cellW + gap}" y="${pad + 34}" font-family="WenQuanYi Micro Hei, Droid Sans Fallback, sans-serif" font-size="22" fill="#141414">${rightCaption}</text>
  </svg>`)
  return sharp(caption).composite([
    { input: leftPng, left: pad, top: pad + captionH },
    { input: rightPng, left: pad + cellW + gap, top: pad + captionH },
  ]).png().toBuffer()
}

async function exportPages(deck: Deck, file: string): Promise<void> {
  const issues = checkDeck(deck)
  if (issues.length) throw new Error(issues.map(item => `${item.pageId}/${item.elementId}: ${item.message}`).join('\n'))
  const result = await exportDeck(deck, file, { platform: 'linux' })
  if (result.status !== 'ok') throw new Error(`导出失败 ${file}`)
}

async function shootDeck(bin: string, pptx: string, names: string[]): Promise<Buffer[]> {
  const pages: Buffer[] = []
  for (let index = 0; index < names.length; index++) {
    const raw = join(tmpdir(), `ppt-layout-${names[index]}.png`)
    officecliScreenshot(bin, pptx, index + 1, raw)
    const png = await fit(raw, WIDTH, HEIGHT)
    const dest = join(OUT, `${names[index]}.png`)
    writeFileSync(dest, png)
    pages.push(png)
    console.log(`page ${names[index]}`)
  }
  return pages
}

async function contactSheet(pages: Buffer[], titles: string[]): Promise<void> {
  const cols = 4
  const cellW = 460
  const cellH = 258
  const labelH = 36
  const gap = 16
  const pad = 20
  const rows = Math.ceil(pages.length / cols)
  const width = pad * 2 + cols * cellW + (cols - 1) * gap
  const height = pad * 2 + rows * (cellH + labelH) + (rows - 1) * gap
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#F7F7F5"/>
    ${titles.map((title, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = pad + col * (cellW + gap)
      const y = pad + row * (cellH + labelH + gap) + cellH + 24
      return `<text x="${x}" y="${y}" font-family="WenQuanYi Micro Hei, Droid Sans Fallback, sans-serif" font-size="18" fill="#141414">${title}</text>`
    }).join('')}
  </svg>`)
  const tiles = await Promise.all(pages.map(page => fit(page, cellW, cellH)))
  const composites = tiles.map((input, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    return {
      input,
      left: pad + col * (cellW + gap),
      top: pad + row * (cellH + labelH + gap),
    }
  })
  const sheet = await sharp(labels).composite(composites).png().toBuffer()
  writeFileSync(join(OUT, 'charts-contact.png'), sheet)
}

function geometryHtml(svg: string): string {
  const sized = svg.includes('width=') ? svg : svg.replace('<svg ', '<svg width="960" height="540" ')
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{width:${WIDTH}px;height:${HEIGHT}px;display:block}</style>${sized}`
}

async function compare(bin: string, deck: Deck, name: string): Promise<void> {
  const dir = join(tmpdir(), `ppt-compare-${name}`)
  mkdirSync(dir, { recursive: true })
  const pptx = join(dir, `${name}.pptx`)
  await exportPages(deck, pptx)
  const svg = geometricPptxPreviews(readFileSync(pptx))[0]
  if (!svg?.includes('<svg')) throw new Error(`${name} 没有几何预览`)
  const html = join(dir, 'geometry.html')
  writeFileSync(html, geometryHtml(svg))
  const before = join(dir, 'before.png')
  const after = join(dir, 'after.png')
  chromeScreenshot(html, before)
  officecliScreenshot(bin, pptx, 1, after)
  const board = await labeledBoard(readFileSync(before), readFileSync(after), '改动前 · 几何 SVG', '改动后 · OfficeCLI HTML')
  writeFileSync(join(OUT, `${name}.png`), board)
  console.log(`compare ${name}`)
}

async function picturePng(path: string): Promise<void> {
  const graphic = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
    <rect width="640" height="400" fill="#C8102E"/>
    <circle cx="160" cy="180" r="90" fill="#F7F7F5"/>
    <rect x="300" y="90" width="250" height="28" fill="#141414"/>
    <rect x="300" y="140" width="180" height="18" fill="#F7F7F5"/>
    <rect x="300" y="176" width="210" height="18" fill="#F7F7F5"/>
    <rect x="300" y="240" width="120" height="64" fill="#141414"/>
  </svg>`)
  await sharp(graphic).png().toFile(path)
}

function sampleDecks(picture: string): Array<{ name: string; deck: Deck }> {
  const theme = argumentTheme
  const chartPage = makeDeck('原生图表', theme, [
    makePage('chart', 'preview-chart', '原生图表', '$paper', [
      text('title', '缺货仓按区域', 48, 36, 500, 40, 28, { bold: true }),
      chart('bars', 48, 100, 860, 380, {
        kind: 'column',
        categories: ['华东', '华南', '华北', '西南'],
        series: [{ name: '缺货仓', values: [4, 2, 3, 1] }],
        colors: ['$accent'],
      }),
    ], ''),
  ])
  const picturePage = makeDeck('图片与圆角', theme, [
    makePage('picture', 'preview-picture', '图片与圆角', '$paper', [
      text('title', '仓配示意', 48, 36, 400, 40, 28, { bold: true }),
      panel('card', 48, 110, 420, 360, '$surface'),
      text('caption', '圆角卡片里的说明', 80, 140, 280, 32, 18, { bold: true }),
      text('body', '几何草图只剩方块和文字。', 80, 188, 340, 28, 15, { color: '$muted' }),
      { id: 'mark', type: 'shape', shape: 'ellipse', role: 'decoration', bounds: { x: 300, y: 280, w: 120, h: 120 }, fill: '$accent' } satisfies DeckElement,
      { id: 'photo', type: 'image', role: 'content', bounds: { x: 520, y: 110, w: 392, h: 360 }, src: picture, alt: '仓配色块', fit: 'fill' } satisfies DeckElement,
    ], ''),
  ])
  const tablePage = makeDeck('表格', theme, [
    makePage('table', 'preview-table', '表格', '$paper', [
      text('title', '三个仓的水位', 48, 36, 500, 40, 28, { bold: true }),
      {
        id: 'grid',
        type: 'table',
        role: 'content',
        bounds: { x: 48, y: 120, w: 864, h: 320 },
        table: {
          columns: [0.28, 0.24, 0.24, 0.24],
          rowHeights: [64, 64, 64, 64, 64],
          fontSize: 16,
          fontFamily: '$cjk',
          color: '$ink',
          fill: '$paper',
          border: { color: '$line', width: 0.75 },
          header: { bold: true, color: '$inverse', fill: '$accent' },
          rows: [
            [{ text: '仓库' }, { text: '周转' }, { text: '缺货' }, { text: '动作' }],
            [{ text: '华东' }, { text: '45 天' }, { text: '3%' }, { text: '维持' }],
            [{ text: '华南' }, { text: '62 天' }, { text: '8%' }, { text: '补货' }],
            [{ text: '华北' }, { text: '51 天' }, { text: '5%' }, { text: '观察' }],
            [{ text: '西南' }, { text: '40 天' }, { text: '1%' }, { text: '稳住' }],
          ],
        },
      },
    ], ''),
  ])
  return [
    { name: 'compare-native-chart', deck: chartPage },
    { name: 'compare-picture-roundrect', deck: picturePage },
    { name: 'compare-table', deck: tablePage },
  ]
}

const bin = officecliBin()
mkdirSync(OUT, { recursive: true })
const work = join(tmpdir(), 'ppt-layout-samples')
mkdirSync(work, { recursive: true })

const argument = buildArgumentDeck()
const argumentFile = join(work, 'argument.pptx')
await exportPages(argument, argumentFile)
await shootDeck(bin, argumentFile, argumentLayouts.map(layout => layout.id))

const gallery = buildChartGalleryDeck()
const galleryFile = join(work, 'charts.pptx')
await exportPages(gallery, galleryFile)
const chartPages = await shootDeck(bin, galleryFile, CHART_GALLERY.map(item => `chart-${item.kind}`))
await contactSheet(chartPages, CHART_GALLERY.map(item => item.title))

const picture = join(work, 'swatch.png')
await picturePng(picture)
for (const sample of sampleDecks(picture)) await compare(bin, sample.deck, sample.name)

console.log(`wrote ${OUT}`)
