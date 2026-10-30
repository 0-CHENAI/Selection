import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import signatures from './case-signatures.json' with { type: 'json' }
import {
  A4_PAGE,
  buildDocx,
  GBT_9704_MARGINS,
  type DocBlock,
  type DocOptions,
  type OutlineBlock,
} from './docx-package.ts'
import { validateMinutes, type MinutesReport } from './validate-minutes.ts'

export { A4_PAGE, GBT_9704_MARGINS }

const CASE_MARGINS: DocOptions = {
  marginTop: 1134,
  marginRight: 1134,
  marginBottom: 1134,
  marginLeft: 1134,
}

export interface MeetingAction {
  task: string
  owner: string
  deadline: string
  deliverable: string
  source?: string
}

export interface MeetingTopic {
  title: string
  discussion: string
  decision: string
}

export interface MeetingRecord {
  title: string
  info: string
  arrangements: string
  topics: MeetingTopic[]
  actions: MeetingAction[]
  pending: string[]
  suggestions?: string
}

export interface MeetingDraft {
  markdown: string
  docx: Buffer
  report: MinutesReport
}

export function meetingMarkdown(record: MeetingRecord): string {
  const topics = record.topics.map(topic => [
    `### ${topic.title}`,
    '',
    `讨论：${topic.discussion}`,
    '',
    `已定：${topic.decision}`,
  ].join('\n')).join('\n\n')
  const rows = record.actions.map(action => `| ${action.task} | ${action.owner} | ${action.deadline} | ${action.deliverable} |`).join('\n')
  const pending = record.pending.map(item => `- ${item}`).join('\n')
  const suggestions = record.suggestions ? `\n\n## 整理建议\n\n${record.suggestions}\n` : ''
  return `# ${record.title}

## 会议信息

${record.info}

## 工作安排

${record.arrangements}

## 议题记录

${topics}

## 行动项

| 任务 | 负责人 | 期限 | 交付标准 |
| --- | --- | --- | --- |
${rows}

## 待确认

${pending}
${suggestions}`
}

export function draftMeetingMinutes(record: MeetingRecord): MeetingDraft {
  const markdown = meetingMarkdown(record)
  const report = validateMinutes(markdown)
  const blocks: DocBlock[] = [
    { kind: 'p', style: 'Title', text: record.title, align: 'center', sizeHalfPoints: 46 },
    { kind: 'p', style: 'Heading1', text: '一、会议信息' },
    { kind: 'p', text: record.info },
    { kind: 'p', style: 'Heading1', text: '二、工作安排' },
    { kind: 'p', text: record.arrangements },
    { kind: 'p', style: 'Heading1', text: '三、议题记录' },
  ]
  for (const topic of record.topics) {
    blocks.push(
      { kind: 'p', style: 'Heading2', text: topic.title },
      { kind: 'p', text: `讨论：${topic.discussion}` },
      { kind: 'p', text: `已定：${topic.decision}` },
    )
  }
  blocks.push({ kind: 'p', style: 'Heading1', text: '四、行动项' })
  blocks.push({
    kind: 'table',
    rows: [
      ['任务与交付要求', '责任分工', '期限'],
      ...record.actions.map(action => [
        `${action.task}\n交付：${action.deliverable}${action.source ? `\n来源：${action.source}` : ''}`,
        action.owner,
        action.deadline,
      ]),
    ],
  })
  blocks.push({ kind: 'p', style: 'Heading1', text: '五、后续确认' })
  blocks.push({ kind: 'p', style: 'Heading2', text: '待确认事项' })
  blocks.push({ kind: 'p', text: record.pending.join('；') || '无' })
  if (record.suggestions) {
    blocks.push({ kind: 'p', style: 'Heading2', text: '整理建议' })
    blocks.push({ kind: 'p', text: record.suggestions })
  }
  return { markdown, docx: buildDocx(blocks, CASE_MARGINS), report }
}

interface SignatureBlock {
  kind: 'heading' | 'table' | 'image'
  style?: string
  text?: string
  columns?: number
  count?: number
}

interface CoffeeSource {
  id: number
  title: string
  publisher: string
  date: string
  url: string
  note: string
}

interface CoffeeInput {
  title: string
  subtitle?: string
  sources: CoffeeSource[]
  scenario?: {
    fixedCost?: number
    prices?: number[]
    monthlyProfitTenThousands?: number[][]
  }
}

function headingStyle(style: string | undefined): 'Title' | 'Heading1' | 'Heading2' | undefined {
  if (style === 'Title' || style === 'Heading1' || style === 'Heading2') return style
  return undefined
}

export function draftCoffeeReport(input: CoffeeInput, images: readonly Uint8Array[]): Buffer {
  const sequence = (signatures as Record<string, SignatureBlock[]>)['coffee-market'] ?? []
  const blocks: DocBlock[] = []
  let imageIndex = 0
  for (const item of sequence) {
    if (item.kind === 'heading') {
      blocks.push({ kind: 'p', style: headingStyle(item.style), text: item.text ?? '' })
      if (item.text === '主要来源') {
        for (const source of input.sources) {
          blocks.push({
            kind: 'p',
            text: `[${source.id}] ${source.title}。${source.publisher}，${source.date}。${source.url}。${source.note}`,
          })
        }
      }
      if (item.text === '05 门店贡献与价格敏感性' && input.scenario?.fixedCost !== undefined) {
        const sample = input.scenario.monthlyProfitTenThousands?.[0]?.[0]
        blocks.push({
          kind: 'p',
          text: `测算输入来自 coffee.json：固定成本 ${input.scenario.fixedCost}，价格档 ${input.scenario.prices?.join('、') ?? '待确认'}。首格月利润（万元）${sample ?? '待确认'}。门店存量与同店销售未出现在该输入中，标为待确认。`,
        })
      }
      continue
    }
    if (item.kind === 'image') {
      const data = images[imageIndex]
      if (!data) throw new Error(`coffee-market 缺少第 ${imageIndex + 1} 张图`)
      imageIndex += 1
      blocks.push({ kind: 'image', data, name: `coffee-chart-${imageIndex}.png` })
      continue
    }
    const columns = item.columns ?? 1
    const header = columns === 4
      ? ['场景', '核心任务', '应验证的需求', '建议观察方式']
      : ['项目', '输入或待确认', '来源']
    const pending = Array.from({ length: columns }, () => '待确认')
    blocks.push({ kind: 'table', rows: [header.slice(0, columns), pending] })
  }
  if (input.subtitle) blocks.splice(1, 0, { kind: 'p', text: input.subtitle })
  return buildDocx(blocks, CASE_MARGINS)
}

interface EquityBlock {
  kind?: string
  role?: string
  text?: string
  runs?: Array<{ text?: string }>
  rows?: unknown[]
  file?: string
  src?: string
  name?: string
}

interface EquityContent {
  cover: EquityBlock[]
  pages: EquityBlock[][]
  images: string[]
  sources: Array<{ id: string; title: string }>
  data?: { deliveries?: number[] }
}

function nestedText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) return value.map(nestedText).join('')
  const record = value as EquityBlock
  if (typeof record.text === 'string' && record.text.length > 0) return record.text
  if (Array.isArray(record.runs)) return record.runs.map(run => run.text ?? '').join('')
  if (Array.isArray(record.rows)) return record.rows.map(nestedText).join('\n')
  return ''
}

function replaceIdentity(text: string, company: string, companyEn: string): string {
  return text
    .replaceAll('小米汽车', company)
    .replaceAll('小米集团', company)
    .replaceAll('XIAOMI AUTO', companyEn)
    .replaceAll('XIAOMI', companyEn)
    .replaceAll('小米', company)
}

function cellText(cell: unknown, swap: boolean, company: string): string {
  if (swap) return '待确认'
  const text = nestedText(cell).replace(/\s+/g, ' ').trim()
  return text || '待确认'
}

function paragraphFor(block: EquityBlock, swap: boolean, company: string, companyEn: string): DocBlock {
  const role = block.role
  const style = role === 'h1' ? 'Heading1' : role === 'h2' ? 'Heading2' : undefined
  const raw = nestedText(block)
  if (swap && style === undefined && (/[0-9]/.test(raw) || raw.includes('小米'))) {
    return { kind: 'p', text: `待确认：该段为示例主体的冻结事实或来源，未替换为${company}的材料。` }
  }
  const text = swap ? replaceIdentity(raw, company, companyEn) : raw
  return { kind: 'p', style, text }
}

export function draftEquityReport(
  content: EquityContent,
  images: ReadonlyMap<string, Uint8Array>,
  company: string,
  companyEn: string,
): Buffer {
  const swap = company !== '小米汽车'
  const blocks: DocBlock[] = []
  if (swap) {
    blocks.push({ kind: 'p', text: `${company}研究报告`, align: 'center', bold: true })
    blocks.push({ kind: 'p', text: companyEn, align: 'center' })
  }
  const emit = (block: EquityBlock) => {
    if (block.kind === 'table') {
      const rows = (block.rows ?? []).map(row => {
        const cells = Array.isArray(row) ? row : []
        return cells.map(cell => cellText(cell, swap, company))
      }).filter(row => row.length > 0)
      if (rows.length === 0) return
      blocks.push({ kind: 'table', rows })
      return
    }
    if (block.kind === 'image') {
      const name = block.file || block.src || block.name || nestedText(block)
      const data = images.get(name)
      if (!data) throw new Error(`equity-research 缺少图片 ${name}`)
      blocks.push({ kind: 'image', data, name })
      return
    }
    blocks.push(paragraphFor(block, swap, company, companyEn))
  }
  for (const block of content.cover) emit(block)
  for (const page of content.pages) for (const block of page) emit(block)
  return buildDocx(blocks, CASE_MARGINS)
}

export function loadEquityContent(caseDir: string): { content: EquityContent; images: Map<string, Uint8Array> } {
  const content = JSON.parse(readFileSync(join(caseDir, 'inputs/report-content.json'), 'utf8')) as EquityContent
  const images = new Map<string, Uint8Array>()
  for (const name of content.images) images.set(name, readFileSync(join(caseDir, 'inputs', name)))
  return { content, images }
}

export interface GovNoticeSpec {
  issuerName: string
  subject: string
  docKind?: string
  year?: number
  mainRecipient?: string
  theme?: string
  startDate?: string
  docNumber?: string
  contactName?: string
}

export interface GovReview {
  ok: boolean
  errors: string[]
}

const NOTICE_HEADINGS = ['一、活动主题和时间', '二、重点工作', '三、组织实施', '四、信息报送'] as const

export function draftGovernmentNotice(spec: GovNoticeSpec): Buffer {
  const docKind = spec.docKind ?? '通知'
  const title = `${spec.issuerName}关于${spec.subject}的${docKind}`
  const docNumber = spec.docNumber ?? '【待补充：发文字号】'
  const recipient = spec.mainRecipient ?? '【待补充：主送机关】'
  const theme = spec.theme ?? '【待补充：活动主题】'
  const start = spec.startDate ?? '【待补充：起止日期】'
  const contact = spec.contactName ?? '【待补充：联系人】'
  const year = spec.year ? String(spec.year) : '【待补充：年份】'
  const blocks: DocBlock[] = [
    {
      kind: 'p',
      text: `${spec.issuerName}文件`,
      align: 'center',
      color: 'FF0000',
      eastAsia: '方正小标宋简体',
      sizeHalfPoints: 70,
      bold: true,
    },
    { kind: 'p', text: docNumber, align: 'center', eastAsia: '仿宋', sizeHalfPoints: 32 },
    { kind: 'p', style: 'Title', text: title, align: 'center', eastAsia: '方正小标宋简体', sizeHalfPoints: 44 },
    { kind: 'p', text: `${recipient}：`, eastAsia: '仿宋', sizeHalfPoints: 32 },
    {
      kind: 'p',
      text: `为做好${year}年${spec.subject}有关工作，现将事项通知如下。未提供的事实保留待补充，不编造文号、日期、印章和联系方式。`,
      eastAsia: '仿宋',
      sizeHalfPoints: 32,
    },
    { kind: 'p', style: 'Heading1', text: NOTICE_HEADINGS[0], eastAsia: '黑体', sizeHalfPoints: 32 },
    { kind: 'p', text: `活动主题为${theme}。起止时间为${start}。`, eastAsia: '仿宋', sizeHalfPoints: 32 },
    { kind: 'p', style: 'Heading1', text: NOTICE_HEADINGS[1], eastAsia: '黑体', sizeHalfPoints: 32 },
    { kind: 'p', text: '重点工作、检查范围、责任单位和完成时限为【待补充：重点工作】。', eastAsia: '仿宋', sizeHalfPoints: 32 },
    { kind: 'p', style: 'Heading1', text: NOTICE_HEADINGS[2], eastAsia: '黑体', sizeHalfPoints: 32 },
    { kind: 'p', text: '牵头部门为【待补充：牵头部门】，配合部门为【待补充：配合部门】。', eastAsia: '仿宋', sizeHalfPoints: 32 },
    { kind: 'p', style: 'Heading1', text: NOTICE_HEADINGS[3], eastAsia: '黑体', sizeHalfPoints: 32 },
    { kind: 'p', text: `联系人为${contact}。报送期限为【待补充：报送期限】，报送渠道为【待补充：报送渠道】。`, eastAsia: '仿宋', sizeHalfPoints: 32 },
    { kind: 'p', text: spec.issuerName, align: 'center', eastAsia: '仿宋', sizeHalfPoints: 32 },
    { kind: 'p', text: '【待补充：成文日期】', align: 'center', eastAsia: '仿宋', sizeHalfPoints: 32 },
    {
      kind: 'table',
      rows: [[`抄送：【待补充：抄送机关】\n【待补充：印发机关】　【待补充：印发日期】印发`]],
    },
  ]
  return buildDocx(blocks, GBT_9704_MARGINS)
}

export function reviewGovernmentNotice(text: string, outline: readonly OutlineBlock[], spec: GovNoticeSpec): GovReview {
  const errors: string[] = []
  const docKind = spec.docKind ?? '通知'
  if (!text.includes(`${spec.issuerName}文件`)) errors.push('版头未使用当前发文机关名称')
  if (!text.includes(`${spec.issuerName}关于${spec.subject}的${docKind}`)) errors.push('标题未由机关、事由和文种组成')
  if (!text.includes('待补充')) errors.push('缺失事实未保留待补充')
  if (!spec.docNumber && /〔\d{4}〕\d+号/.test(text)) errors.push('未提供文号时不应生成正式发文字号')
  for (const heading of NOTICE_HEADINGS) {
    if (!outline.some(block => block.kind === 'heading' && block.text === heading)) errors.push(`缺少结构：${heading}`)
  }
  if (!outline.some(block => block.kind === 'table')) errors.push('缺少版记')
  if (text.includes('中国中车') || text.includes('质量安全月')) errors.push('新稿不应复用示例通知的机关或专题原文')
  return { ok: errors.length === 0, errors }
}

export function caseSignature(id: 'meeting-minutes' | 'coffee-market' | 'equity-research' | 'government-notice'): OutlineBlock[] {
  return ((signatures as Record<string, SignatureBlock[]>)[id] ?? []).map(block => ({ ...block }))
}
