/**
 * 把 Selection 管线产物和 dsh 案例样例渲成页图，并排存到 artifacts。
 * 不调用模型，不用 OCR。OfficeCLI HTML + Chrome 截图。
 * 用法：OFFICECLI=/tmp/officecli/officecli bun scripts/selection-3.2-office-quality-render.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { draftGovernmentNotice, draftMeetingMinutes, type MeetingRecord } from '../packages/office-business-runtime/src/word-drafts.ts'

const repo = join(import.meta.dir, '..')
const officecli = process.env.OFFICECLI ?? '/tmp/officecli/officecli'
const out = process.env.QUALITY_OUT ?? '/opt/cursor/artifacts/office-parity'
const cases = join(repo, 'apps/electron/resources/skills/office-business/cases')
const work = join(out, 'work')
mkdirSync(work, { recursive: true })

const park: MeetingRecord = {
  title: '园区门禁改造会议纪要',
  info: '会议名称：园区门禁改造会。主持人：周宁。会议日期待确认。',
  arrangements: '已定：先改造北门人行闸机，车库入口维持现状。',
  topics: [
    { title: '议题一：北门范围', discussion: '周宁说明北门高峰排队。', decision: '已定先改北门。' },
    { title: '议题二：权限分组', discussion: '访客是否当天失效尚未统一。', decision: '待确认：访客失效时点。' },
    { title: '议题三：施工窗口', discussion: '物业建议避开周一早高峰。', decision: '已定施工放在周三夜间。' },
  ],
  actions: [
    { task: '提交北门方案', owner: '周宁', deadline: '2026-11-06', deliverable: '一页示意图', source: '周宁当场认领' },
  ],
  pending: ['会议日期待确认'],
  suggestions: '整理建议：把访客规则和公告分开跟踪。',
}

function run(cmd: string, args: string[], timeout = 60_000): void {
  execFileSync(cmd, args, { timeout, stdio: 'pipe' })
}

function htmlOf(file: string, html: string, extra: string[] = []): void {
  run(officecli, ['view', file, 'html', ...extra, '-o', html], 90_000)
}

function shoot(html: string, png: string, width: number, height: number): void {
  const dir = join('/tmp', `selection-chrome-${process.pid}-${png.split('/').pop()}`)
  mkdirSync(dir, { recursive: true })
  try {
    execFileSync('timeout', ['25', 'google-chrome', '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${dir}`, `--window-size=${width},${height}`, `--screenshot=${png}`, `file://${html}`], { stdio: 'pipe' })
  } catch (error) {
    const code = (error as { status?: number }).status
    if (code !== 124) throw error
  }
}

async function label(text: string, width: number): Promise<Buffer> {
  const svg = `<svg width="${width}" height="48"><rect width="100%" height="100%" fill="#1f2933"/><text x="16" y="31" fill="#f8fafc" font-size="20" font-family="Noto Sans CJK SC, sans-serif">${text}</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function side(left: string, right: string, dest: string, leftLabel: string, rightLabel: string): Promise<void> {
  const a = sharp(left)
  const b = sharp(right)
  const am = await a.metadata()
  const bm = await b.metadata()
  const height = Math.min(am.height ?? 800, bm.height ?? 800, 1600)
  const aw = am.width ?? 800
  const bw = bm.width ?? 800
  const leftPng = await a.extract({ left: 0, top: 0, width: aw, height }).png().toBuffer()
  const rightPng = await b.extract({ left: 0, top: 0, width: bw, height }).png().toBuffer()
  const leftBar = await label(leftLabel, aw)
  const rightBar = await label(rightLabel, bw)
  const leftCol = await sharp({ create: { width: aw, height: height + 48, channels: 3, background: '#fff' } })
    .composite([{ input: leftBar, top: 0, left: 0 }, { input: leftPng, top: 48, left: 0 }]).png().toBuffer()
  const rightCol = await sharp({ create: { width: bw, height: height + 48, channels: 3, background: '#fff' } })
    .composite([{ input: rightBar, top: 0, left: 0 }, { input: rightPng, top: 48, left: 0 }]).png().toBuffer()
  await sharp({ create: { width: aw + bw + 16, height: height + 48, channels: 3, background: '#e5e7eb' } })
    .composite([{ input: leftCol, top: 0, left: 0 }, { input: rightCol, top: 0, left: aw + 16 }])
    .png().toFile(dest)
}

async function single(src: string, dest: string, caption: string): Promise<void> {
  const meta = await sharp(src).metadata()
  const width = meta.width ?? 800
  const height = Math.min(meta.height ?? 800, 1600)
  const body = await sharp(src).extract({ left: 0, top: 0, width, height }).png().toBuffer()
  const bar = await label(caption, width)
  await sharp({ create: { width, height: height + 48, channels: 3, background: '#fff' } })
    .composite([{ input: bar, top: 0, left: 0 }, { input: body, top: 48, left: 0 }])
    .png().toFile(dest)
}

function page(file: string, name: string, extra: string[] = [], size: [number, number] = [1000, 1800]): string {
  const html = join(work, `${name}.html`)
  const png = join(work, `${name}.png`)
  htmlOf(file, html, extra)
  shoot(html, png, size[0], size[1])
  return png
}

function tryPage(file: string, name: string, extra: string[] = [], size: [number, number] = [1000, 1800]): string | undefined {
  try {
    return page(file, name, extra, size)
  } catch (error) {
    writeFileSync(join(work, `${name}.error.txt`), error instanceof Error ? error.message : String(error))
    return undefined
  }
}

function checks(file: string, checksFile: string): unknown[] {
  const items = JSON.parse(readFileSync(checksFile, 'utf8')) as Array<{ sheet: string; cell: string; expected: number; tolerance: number }>
  return items.map(item => {
    const raw = execFileSync(officecli, ['get', file, `${item.sheet}!${item.cell}`, '--json'], { encoding: 'utf8' })
    const parsed = JSON.parse(raw) as { data: { results: Array<{ format?: { computedValue?: string; formula?: string } }> } }
    const format = parsed.data.results[0]?.format
    const value = Number(format?.computedValue)
    return { cell: `${item.sheet}!${item.cell}`, formula: format?.formula, value, expected: item.expected, ok: Math.abs(value - item.expected) <= item.tolerance }
  })
}

const minutesDraft = join(work, 'minutes-selection.docx')
writeFileSync(minutesDraft, draftMeetingMinutes(park).docx)
const govDraft = join(work, 'gov-selection.docx')
writeFileSync(govDraft, draftGovernmentNotice({
  issuerName: '滨江市城市管理局',
  subject: '开展市容环境整治',
  year: 2026,
  mainRecipient: '各区城市管理局',
  theme: '洁净街区',
  startDate: '2026年11月',
  contactName: '待补充',
}))

const minutesDsh = tryPage(join(cases, 'meeting-minutes/example.docx'), 'minutes-dsh', ['--page', '1'])
const minutesSel = tryPage(minutesDraft, 'minutes-sel', ['--page', '1'])
const govDsh = tryPage(join(cases, 'government-notice/example.docx'), 'gov-dsh', ['--page', '1'])
const govSel = tryPage(govDraft, 'gov-sel', ['--page', '1'])
const lease = tryPage(join(cases, 'house-lease/example.docx'), 'lease', ['--page', '1'])
const port = tryPage(join(cases, 'port-cargo/example.xlsx'), 'port', ['--range', '港口总览!A1:P24'], [1400, 900])
const bio = tryPage(join(cases, 'bio-assay/example.xlsx'), 'bio', ['--range', '实验总览!A1:L24'], [1400, 900])
const budget = tryPage(join(cases, 'household-budget/example.xlsx'), 'budget', ['--range', 'A1:L30'], [1400, 1000])
const quote = tryPage(join(cases, 'equipment-quote/example.xlsx'), 'quote', ['--range', 'A1:L24'], [1400, 900])

if (minutesDsh && minutesSel) await side(minutesDsh, minutesSel, join(out, 'word-minutes.png'), 'dsh 会议纪要样例', 'Selection 园区纪要草稿')
if (govDsh && govSel) await side(govDsh, govSel, join(out, 'word-gov.png'), 'dsh 公文样例首页', 'Selection 城管通知草稿')
if (lease) await single(lease, join(out, 'word-lease.png'), 'Selection 房屋租赁合同（dsh 无此类）')
if (port) await single(port, join(out, 'excel-port.png'), '港口总览（dsh 与 Selection 案例字节相同）')
if (bio) await single(bio, join(out, 'excel-bio.png'), '荧光酶实验总览（案例字节相同）')
if (budget && quote) await side(budget, quote, join(out, 'excel-personal.png'), 'Selection 家庭预算', 'Selection 设备报价')

const formula = {
  port: checks(join(cases, 'port-cargo/example.xlsx'), join(cases, 'port-cargo/checks.json')),
  bio: checks(join(cases, 'bio-assay/example.xlsx'), join(cases, 'bio-assay/checks.json')),
}
writeFileSync(join(out, 'formula-checks.json'), JSON.stringify(formula, null, 2))

const pptNotes: string[] = []
for (const [name, deck] of [
  ['ppt-blue', 'apps/electron/resources/skills/ppt-design/styles/dsh-blue-professional/deck.json'],
  ['ppt-cartesian', 'apps/electron/resources/skills/ppt-design/styles/dsh-cartesian/deck.json'],
  ['ppt-economy', 'apps/electron/resources/skills/ppt-design/styles/examples/ppt169_china_economy_2025_briefing/deck.json'],
] as const) {
  const pptx = join(work, `${name}.pptx`)
  try {
    execFileSync('bun', [join(repo, 'apps/electron/resources/skills/ppt-design/engine/cli.ts'), 'render', join(repo, deck), '--out', pptx, '--platform', 'linux'], { timeout: 120_000, stdio: 'pipe' })
    const png = tryPage(pptx, name, ['--page', '1'], [1400, 800])
    if (png) await single(png, join(out, `${name}.png`), `Selection deck 导出 ${name}（dsh 588412b 未提交成稿）`)
    pptNotes.push(`${name}: ok`)
  } catch (error) {
    pptNotes.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
writeFileSync(join(out, 'ppt-export.txt'), pptNotes.join('\n'))
console.log('wrote', out)
