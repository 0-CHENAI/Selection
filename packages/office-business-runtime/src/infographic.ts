/**
 * HTML/SVG 信息图。指名调色板时 SVG 结构与 build_infographic.py 一致。
 * palette=auto 不用 Python hash()，改用稳定的 FNV，避免进程盐导致对拍漂移。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pythonFixed } from './python-number.ts'

type Palette = {
  bg: string
  card: string
  primary: string
  text: string
  text_light: string
  colors: string[]
  up: string
  down: string
}

const PALETTES: Record<string, Palette> = {
  ocean: { bg: '#eef4fb', card: '#ffffff', primary: '#0077b6', text: '#023e8a', text_light: '#4a6fa5', colors: ['#0077b6', '#00b4d8', '#48cae4', '#90e0ef', '#0096c7', '#005f8a'], up: '#0a9396', down: '#e63946' },
  sunset: { bg: '#fef6f0', card: '#ffffff', primary: '#e76f51', text: '#1d3557', text_light: '#6b7b8d', colors: ['#e63946', '#f4845f', '#f7b267', '#e76f51', '#c1121f', '#d4a373'], up: '#2a9d8f', down: '#e63946' },
  forest: { bg: '#eef7ee', card: '#ffffff', primary: '#2d6a4f', text: '#1b4332', text_light: '#6b8f71', colors: ['#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#1b4332'], up: '#2d6a4f', down: '#c1121f' },
  berry: { bg: '#f8f0fa', card: '#ffffff', primary: '#7b2cbf', text: '#3c096c', text_light: '#8a6baa', colors: ['#7b2cbf', '#9d4edd', '#c77dff', '#e0aaff', '#5a189a', '#240046'], up: '#2a9d8f', down: '#e63946' },
  vibrant: { bg: '#f5f6fa', card: '#ffffff', primary: '#4361ee', text: '#1a1a2e', text_light: '#6c757d', colors: ['#4361ee', '#f72585', '#4cc9f0', '#7209b7', '#3a0ca3', '#f77f00'], up: '#06d6a0', down: '#ef476f' },
  corporate: { bg: '#f0f2f5', card: '#ffffff', primary: '#1a365d', text: '#1a202c', text_light: '#718096', colors: ['#1a365d', '#2b6cb0', '#3182ce', '#63b3ed', '#2c5282', '#4a5568'], up: '#38a169', down: '#e53e3e' },
  pastel: { bg: '#fafafa', card: '#ffffff', primary: '#6c8ebf', text: '#333333', text_light: '#888888', colors: ['#6c8ebf', '#d4a5a5', '#a8d8b9', '#f0d9b5', '#b8b8d1', '#f5c6aa'], up: '#68b684', down: '#d4a5a5' },
  earth: { bg: '#f9f5f0', card: '#ffffff', primary: '#8b5e3c', text: '#3e2723', text_light: '#795548', colors: ['#8b5e3c', '#a0522d', '#c49a6c', '#ddc9a3', '#6d4c41', '#5d4037'], up: '#558b2f', down: '#c62828' },
}

const PALETTE_NAMES = Object.keys(PALETTES)

export interface InfographicConfig {
  title?: string
  subtitle?: string
  type?: string
  palette?: string
  data?: unknown
  output?: string
  footer?: string
}

export interface NativeChartCommand {
  command: string
  note: string
}

export function buildInfographic(config: InfographicConfig, nativeChart = false): { html: string; palette: string; nativeChart: NativeChartCommand[] } {
  const errors = validateConfig(config)
  if (errors.length > 0) throw new InfographicError(errors)
  const type = config.type ?? 'stats'
  const paletteName = config.palette ?? 'auto'
  const palette = pickPalette(paletteName, config.data ?? {})
  const data = config.data ?? {}
  const body = type === 'comparison' ? buildComparison(asRecord(data), palette)
    : type === 'flow' ? buildFlow(data, palette)
      : type === 'dashboard' ? buildDashboard(asRecord(data), palette)
        : buildStats(data, palette)
  const html = wrapHtml(config.title ?? 'Infographic', config.subtitle ?? '', body, config.footer ?? '', palette)
  return { html, palette: paletteName, nativeChart: nativeChart ? nativeChartCommands(config) : [] }
}

export class InfographicError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '))
  }
}

export function renderInfographicFile(config: InfographicConfig, nativeChart = false): { status: 'success'; output: string; type: string; title: string; palette: string; size_bytes: number; native_chart?: NativeChartCommand[] } {
  const built = buildInfographic(config, nativeChart)
  const output = resolve(config.output ?? 'infographic.html')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, built.html)
  const result = {
    status: 'success' as const,
    output,
    type: config.type ?? 'stats',
    title: config.title ?? 'Infographic',
    palette: built.palette,
    size_bytes: Buffer.byteLength(built.html),
  }
  return nativeChart ? { ...result, native_chart: built.nativeChart } : result
}

export function readInfographicConfig(path: string): InfographicConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as InfographicConfig
}

export function stableAutoPalette(data: unknown): string {
  const text = JSON.stringify(sortKeys(data))
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return PALETTE_NAMES[(hash >>> 0) % PALETTE_NAMES.length] ?? 'ocean'
}

/** OfficeCLI 原生图表优先。能用柱图表达的对比和仪表盘趋势走单元格数据区，HTML 只是补充。 */
export function nativeChartCommands(config: InfographicConfig): NativeChartCommand[] {
  const type = config.type ?? 'stats'
  const chart = type === 'comparison' ? asRecord(config.data) : type === 'dashboard' ? asRecord(asRecord(config.data).chart) : null
  if (!chart || !Array.isArray(chart.categories) || !Array.isArray(chart.series)) return []
  const title = String(chart.chart_title ?? config.title ?? '图表')
  const columns = 1 + (chart.series as unknown[]).length
  const end = columnName(columns)
  const rows = (chart.categories as unknown[]).length + 1
  return [{
    command: `officecli add "$FILE" "/图表/chart" --prop type=column --prop title=${JSON.stringify(title)} --prop dataRange="图表!A1:${end}${rows}"`,
    note: '先把分类写到「图表」!A 列、每个系列写到后续列，再执行这条命令。图表必须是原生 Excel 图表，不能粘贴成图片。',
  }]
}

function pickPalette(name: string, data: unknown): Palette {
  if (name && name !== 'auto' && PALETTES[name]) return PALETTES[name]!
  return PALETTES[stableAutoPalette(data)]!
}

function colorAt(palette: Palette, index: number): string {
  return palette.colors[index % palette.colors.length] ?? palette.primary
}

function buildComparison(data: Record<string, unknown>, palette: Palette): string {
  const title = String(data.chart_title ?? '')
  const titleHtml = title
    ? `<h3 style="margin:0 0 16px;font-size:18px;font-weight:600;color:${palette.text}">${esc(title)}</h3>`
    : ''
  return `<div style="background:${palette.card};border-radius:14px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">${titleHtml}${barChart(data, palette)}</div>`
}

function barChart(data: Record<string, unknown>, palette: Palette, chartW = 760, chartH = 360): string {
  const categories = Array.isArray(data.categories) ? data.categories : []
  const series = Array.isArray(data.series) ? data.series.map(asRecord) : []
  if (categories.length === 0 || series.length === 0) return '<p style="color:#888">No chart data provided.</p>'
  const values = series.flatMap(item => numberList(item.values))
  if (values.length === 0) return '<p style="color:#888">No values in series.</p>'
  const padL = 65
  const padR = 20
  const padT = 30
  const padB = 55
  const plotW = chartW - padL - padR
  const plotH = chartH - padT - padB
  const maxVal = Math.max(...values) * 1.15 || 1
  const groupW = plotW / categories.length
  const barGap = Math.max(2, groupW * 0.1)
  const barW = Math.max(8, (groupW - barGap * 2) / series.length)
  const lines = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chartW} ${chartH}" style="width:100%;max-width:${chartW}px;height:auto">`]
  for (let i = 0; i <= 5; i += 1) {
    const val = maxVal * i / 5
    const y = padT + plotH - (plotH * i / 5)
    lines.push(`<line x1="${padL}" y1="${f1(y)}" x2="${padL + plotW}" y2="${f1(y)}" stroke="#e0e0e0" stroke-width="1"/>`)
    lines.push(`<text x="${padL - 8}" y="${f1(y + 4)}" text-anchor="end" font-size="11" fill="${palette.text_light}">${formatNumber(val, 'float')}</text>`)
  }
  categories.forEach((category, index) => {
    const cx = padL + groupW * index + groupW / 2
    lines.push(`<text x="${f1(cx)}" y="${padT + plotH + 20}" text-anchor="middle" font-size="12" fill="${palette.text}">${esc(String(category))}</text>`)
  })
  series.forEach((item, seriesIndex) => {
    const color = colorAt(palette, seriesIndex)
    numberList(item.values).forEach((val, categoryIndex) => {
      const barH = maxVal ? (val / maxVal) * plotH : 0
      const x = padL + groupW * categoryIndex + barGap + barW * seriesIndex
      const y = padT + plotH - barH
      lines.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(barW)}" height="${f1(barH)}" rx="3" fill="${color}" opacity="0.88"><title>${esc(String(item.name ?? ''))}: ${formatNumber(val, Number.isInteger(val) ? 'int' : 'float')}</title></rect>`)
    })
  })
  if (series.length > 1) {
    let legX = padL
    for (const [index, item] of series.entries()) {
      const color = colorAt(palette, index)
      const name = String(item.name ?? '')
      lines.push(`<rect x="${legX}" y="${chartH - 8 - 8}" width="12" height="12" rx="2" fill="${color}"/>`)
      lines.push(`<text x="${legX + 16}" y="${chartH - 8 + 2}" font-size="11" fill="${palette.text}">${esc(name)}</text>`)
      legX += 16 + name.length * 7 + 20
    }
  }
  lines.push('</svg>')
  return lines.join('\n')
}

function buildStats(data: unknown, palette: Palette): string {
  const items = Array.isArray(data) ? data.map(asRecord) : listOf(asRecord(data), 'items', 'stats')
  if (items.length === 0) return '<p style="color:#888">No stats data provided.</p>'
  const cards = items.map((item, index) => {
    const color = colorAt(palette, index)
    const trend = item.trend == null ? '' : String(item.trend)
    const up = item.trend_dir !== 'down'
    const trendColor = up ? palette.up : palette.down
    const trendHtml = trend
      ? `<div style="display:flex;align-items:center;gap:4px;color:${trendColor};font-size:13px;font-weight:600;margin-top:4px">${esc(trend)}</div>`
      : ''
    return `<div style="background:${palette.card};border-radius:14px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:8px;min-width:180px"><div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:13px;color:${palette.text_light};font-weight:500">${esc(String(item.label ?? ''))}</span></div><div style="font-size:28px;font-weight:700;color:${palette.text};letter-spacing:-0.5px">${esc(String(item.value ?? ''))}</div>${trendHtml}</div>`
  })
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px">${cards.join(' ')}</div>`
}

function buildFlow(data: unknown, palette: Palette): string {
  const steps = Array.isArray(data) ? data.map(asRecord) : listOf(asRecord(data), 'steps')
  if (steps.length === 0) return '<p style="color:#888">No flow data provided.</p>'
  const stepW = 180
  const stepH = 90
  const gap = 50
  const totalW = steps.length * stepW + (steps.length - 1) * gap + 40
  const totalH = stepH + 80
  const yCenter = totalH / 2
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" style="width:100%;max-width:${totalW}px;height:auto;overflow:visible">`,
    '<defs>',
    `<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${palette.primary}"/></marker>`,
    '</defs>',
  ]
  steps.forEach((step, index) => {
    const x = 20 + index * (stepW + gap)
    const color = colorAt(palette, index)
    const ry = yCenter - stepH / 2
    const title = esc(String(step.title ?? `Step ${step.step ?? index + 1}`))
    const desc = esc(String(step.description ?? ''))
    lines.push(`<rect x="${x}" y="${f1(ry)}" width="${stepW}" height="${stepH}" rx="12" fill="${color}" opacity="0.13"/>`)
    lines.push(`<rect x="${x}" y="${f1(ry)}" width="${stepW}" height="${stepH}" rx="12" fill="none" stroke="${color}" stroke-width="2"/>`)
    lines.push(`<circle cx="${x + 22}" cy="${f1(ry + 22)}" r="14" fill="${color}"/>`)
    lines.push(`<text x="${x + 22}" y="${f1(ry + 22 + 5)}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${step.step ?? index + 1}</text>`)
    lines.push(`<text x="${x + stepW / 2}" y="${f1(ry + 48)}" text-anchor="middle" font-size="14" font-weight="600" fill="${palette.text}">${title}</text>`)
    if (desc) lines.push(`<text x="${x + stepW / 2}" y="${f1(ry + 68)}" text-anchor="middle" font-size="11" fill="${palette.text_light}">${desc}</text>`)
    if (index < steps.length - 1) {
      lines.push(`<line x1="${x + stepW + 4}" y1="${yCenter}" x2="${x + stepW + gap - 4}" y2="${yCenter}" stroke="${palette.primary}" stroke-width="2" marker-end="url(#arrowhead)"/>`)
    }
  })
  lines.push('</svg>')
  return `<div style="background:${palette.card};border-radius:14px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);overflow-x:auto">${lines.join('\n')}</div>`
}

function buildDashboard(data: Record<string, unknown>, palette: Palette): string {
  const sections: string[] = []
  const stats = listOf(data, 'stats')
  if (stats.length > 0) sections.push(buildStats(stats, palette))
  if (data.chart && typeof data.chart === 'object') sections.push(buildComparison(asRecord(data.chart), palette))
  const breakdown = listOf(data, 'breakdown')
  if (breakdown.length > 0) {
    const legend = breakdown.map((item, index) => {
      const color = typeof item.color === 'string' ? item.color : colorAt(palette, index)
      return `<div style="display:flex;align-items:center;gap:8px;font-size:13px"><span style="width:12px;height:12px;border-radius:3px;background:${color};flex-shrink:0"></span><span style="color:${palette.text}">${esc(String(item.label ?? ''))}</span><span style="color:${palette.text_light};margin-left:auto">${formatNumber(Number(item.value ?? 0), Number.isInteger(Number(item.value ?? 0)) ? 'int' : 'float')}</span></div>`
    }).join('')
    sections.push(`<div style="background:${palette.card};border-radius:14px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);display:flex;align-items:center;gap:32px;flex-wrap:wrap"><div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:10px">${legend}</div></div>`)
  }
  const flow = listOf(data, 'flow')
  if (flow.length > 0) sections.push(buildFlow(flow, palette))
  return sections.join('\n')
}

function wrapHtml(title: string, subtitle: string, body: string, footer: string, palette: Palette): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,
    "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
  background:${palette.bg};
  color:${palette.text};
  line-height:1.6;
  min-height:100vh;
}
.container{
  max-width:960px;
  margin:0 auto;
  padding:40px 24px;
}
header{
  text-align:center;
  margin-bottom:36px;
}
header h1{
  font-size:32px;
  font-weight:800;
  color:${palette.text};
  letter-spacing:-0.5px;
  margin-bottom:8px;
}
header .subtitle{
  font-size:15px;
  color:${palette.text_light};
  max-width:600px;
  margin:0 auto;
}
main{
  display:flex;
  flex-direction:column;
  gap:24px;
}
footer.ig-footer{
  text-align:center;
  margin-top:40px;
  padding-top:20px;
  border-top:1px solid rgba(0,0,0,0.06);
  font-size:12px;
  color:${palette.text_light};
}
@media(max-width:640px){
  .container{padding:20px 12px}
  header h1{font-size:24px}
}
</style>
</head>
<body>
<div class="container">
<header>
<h1>${esc(title)}</h1>
${subtitle ? `<p class='subtitle'>${esc(subtitle)}</p>` : ''}
</header>
<main>
${body}
</main>
${footer ? `<footer class='ig-footer'>${esc(footer)}</footer>` : ''}
</div>
</body>
</html>`
}

function validateConfig(config: InfographicConfig): string[] {
  const errors: string[] = []
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['Config must be a JSON object']
  const type = config.type ?? 'stats'
  if (!['stats', 'comparison', 'flow', 'dashboard'].includes(type)) {
    errors.push(`Invalid type '${type}'. Must be one of: comparison, dashboard, flow, stats`)
  }
  if (!('data' in config)) errors.push('Missing required field: data')
  return errors
}

function formatNumber(value: number, kind: 'int' | 'float'): string {
  if (kind === 'float') {
    if (value >= 1_000_000) return `${f1(value / 1_000_000)}M`
    if (value >= 1_000) return `${f1(value / 1_000)}K`
    return f1(value)
  }
  if (value >= 1_000_000) return `${f1(value / 1_000_000)}M`
  if (value >= 1_000) return group(value)
  return String(value)
}

function f1(value: number): string {
  return pythonFixed(value, 1)
}

function group(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function listOf(record: Record<string, unknown>, ...keys: string[]): Array<Record<string, unknown>> {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value.map(asRecord)
  }
  return []
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : []
}

function columnName(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, sortKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}
