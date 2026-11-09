import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { documentXml, mediaDigests, plainText, readMargins, readOutline, type OutlineBlock } from './docx-package.ts'
import { evaluatePreviewChecks } from './preview-checks.ts'
import {
  caseSignature,
  draftCoffeeReport,
  draftEquityReport,
  draftGovernmentNotice,
  draftMeetingMinutes,
  GBT_9704_MARGINS,
  loadEquityContent,
  reviewGovernmentNotice,
  splitGovTitle,
  type MeetingRecord,
} from './word-drafts.ts'

const repoRoot = join(import.meta.dir, '../../..')
const office = join(repoRoot, 'apps/electron/resources/skills/office-business')

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function shape(blocks: readonly OutlineBlock[]): string[] {
  return blocks.map(block => {
    if (block.kind === 'heading') return `h:${block.style}:${block.text}`
    if (block.kind === 'table') return `t:${block.columns}`
    return `i:${block.count}`
  })
}

function styleShape(blocks: readonly OutlineBlock[]): string[] {
  return blocks.map(block => {
    if (block.kind === 'heading') return `h:${block.style}`
    if (block.kind === 'table') return `t:${block.columns}`
    return `i:${block.count}`
  })
}

const parkMeeting: MeetingRecord = {
  title: '园区门禁改造会议纪要',
  info: '会议名称：园区门禁改造会。主持人：周宁。会议日期待确认。',
  arrangements: '已定：先改造北门人行闸机，车库入口维持现状。',
  topics: [
    { title: '议题一：北门范围', discussion: '周宁说明北门高峰排队。', decision: '已定先改北门。' },
    { title: '议题二：权限分组', discussion: '访客是否当天失效尚未统一。', decision: '待确认：访客失效时点。' },
    { title: '议题三：施工窗口', discussion: '物业建议避开周一早高峰。', decision: '已定施工放在周三夜间。' },
    { title: '议题四：通知住户', discussion: '公告稿还没有起草人。', decision: '待确认：公告起草人。' },
    { title: '议题五：验收', discussion: '需要一次步行检查。', decision: '已定由周宁验收。' },
  ],
  actions: [
    { task: '提交北门方案', owner: '周宁', deadline: '2026-11-06', deliverable: '一页示意图', source: '周宁当场认领' },
    { task: '确认访客规则', owner: '待确认', deadline: '下周', deliverable: '一条书面规则' },
  ],
  pending: ['会议日期待确认', '公告起草人待确认'],
  suggestions: '整理建议：把访客规则和公告分开跟踪。',
}

describe('word case drafts', () => {
  test('W1 meeting draft keeps the case skeleton and passes validate_minutes', () => {
    const example = join(office, 'cases/meeting-minutes/example.docx')
    const before = sha256(example)
    const draft = draftMeetingMinutes(parkMeeting)
    expect(draft.report.passed).toBe(true)
    expect(draft.report.exitCode).toBe(0)
    expect(draft.markdown).toContain('## 议题记录')
    expect(draft.markdown).toContain('讨论：')
    expect(draft.markdown).toContain('已定：')
    expect(draft.markdown).toContain('## 待确认')
    expect(draft.markdown).toContain('| 任务 | 负责人 | 期限 | 交付标准 |')
    const outline = readOutline(draft.docx)
    expect(styleShape(outline)).toEqual(styleShape(readOutline(readFileSync(example))))
    const text = plainText(draft.docx)
    expect(text).toContain('周宁')
    expect(text).toContain('提交北门方案')
    expect(text).not.toContain('李天天')
    expect(text).not.toContain('发布会筹备')
    expect(sha256(example)).toBe(before)
    expect(sha256(example)).toBe('b301c5e5801c62887a44f26379bc71f6c60cbdd21f45db13d63543f88abe6575')
  })

  test('W2 coffee draft follows the example structure and only uses coffee.json facts', () => {
    const caseDir = join(office, 'cases/coffee-market')
    const example = join(caseDir, 'example.docx')
    const before = sha256(example)
    const input = JSON.parse(readFileSync(join(caseDir, 'inputs/coffee.json'), 'utf8')) as {
      title: string
      subtitle: string
      sources: Array<{ id: number; title: string; publisher: string; date: string; url: string; note: string }>
      scenario: { fixedCost: number; prices: number[]; monthlyProfitTenThousands: number[][] }
    }
    const images = [1, 2, 3, 4].map(index => readFileSync(join(caseDir, 'inputs', `coffee-chart-${index}.png`)))
    const docx = draftCoffeeReport(input, images)
    expect(shape(readOutline(docx))).toEqual(shape(caseSignature('coffee-market')))
    expect(shape(readOutline(readFileSync(example)))).toEqual(shape(caseSignature('coffee-market')))
    const text = plainText(docx)
    for (const source of input.sources) expect(text).toContain(source.title)
    expect(text).toContain(String(input.scenario.fixedCost))
    expect(text).not.toContain('22340')
    expect(text).not.toContain('7,596')
    expect(mediaDigests(docx)).toEqual(images.map(image => createHash('sha256').update(image).digest('hex')))
    expect(sha256(example)).toBe(before)
  })

  test('W3 equity replay keeps charts and sources, and a renamed company does not inherit the sample facts', () => {
    const caseDir = join(office, 'cases/equity-research')
    const example = join(caseDir, 'example.docx')
    const before = sha256(example)
    const { content, images } = loadEquityContent(caseDir)
    const replay = draftEquityReport(content, images, '小米汽车', 'XIAOMI AUTO')
    expect(shape(readOutline(replay))).toEqual(shape(caseSignature('equity-research')))
    expect(shape(readOutline(readFileSync(example)))).toEqual(shape(caseSignature('equity-research')))
    const replayText = plainText(replay)
    const sourceTitle = content.sources[0]?.title
    if (!sourceTitle) throw new Error('研报输入缺少来源标题')
    expect(replayText).toContain(sourceTitle)
    expect(replayText).toContain('41.11')
    expect(mediaDigests(replay)).toEqual(content.images.map(name => createHash('sha256').update(images.get(name)!).digest('hex')))

    const renamed = draftEquityReport(content, images, '北辰智行', 'BEICHEN AUTO')
    expect(shape(readOutline(renamed))).toEqual(shape(caseSignature('equity-research')))
    const renamedText = plainText(renamed)
    expect(renamedText).toContain('北辰智行')
    expect(renamedText).toContain('BEICHEN AUTO')
    expect(renamedText).not.toContain('小米汽车')
    expect(renamedText).not.toContain('小米集团')
    expect(renamedText).not.toContain('41.11')
    expect(renamedText).toContain('待确认')
    expect(mediaDigests(renamed)).toEqual(mediaDigests(replay))
    expect(sha256(example)).toBe(before)
  })

  test('W4 notice uses the current issuer, keeps 待补充, and leaves the sample untouched', () => {
    const example = join(office, 'cases/government-notice/example.docx')
    const before = sha256(example)
    expect(shape(readOutline(readFileSync(example)))).toEqual(shape(caseSignature('government-notice')))
    const spec = { issuerName: '滨江市城市管理局', subject: '开展市政设施安全检查', year: 2026 }
    const docx = draftGovernmentNotice(spec)
    const outline = readOutline(docx)
    const text = plainText(docx)
    const review = reviewGovernmentNotice(text, outline, spec)
    expect(review.errors).toEqual([])
    expect(readMargins(docx)).toEqual(GBT_9704_MARGINS)
    expect(text).toContain('滨江市城市管理局文件')
    expect(text).toContain('【待补充：发文字号】')
    expect(text).not.toContain('中国中车')
    expect(text).not.toContain('质量安全月')
    expect(sha256(example)).toBe(before)
    expect(before).toBe('c763f627f09e543505b4cfaea34487a0b8cd724b549e4762633153da61ddf961')
  })

  test('W4 title breaks at a phrase boundary and the record block has rules', () => {
    expect(splitGovTitle('滨江市城市管理局关于开展市容环境整治的通知')).toEqual(['滨江市城市管理局关于', '开展市容环境整治的通知'])
    expect(splitGovTitle('某局关于做好冬季工作的通知')).toEqual(['某局关于做好冬季工作的通知'])
    const xml = documentXml(draftGovernmentNotice({ issuerName: '滨江市城市管理局', subject: '开展市容环境整治', year: 2026 }))
    expect(xml).toContain('滨江市城市管理局关于</w:t></w:r><w:r>')
    expect(xml).toContain('<w:br/>')
    expect(xml).toContain('w:color="FF0000"/></w:pBdr>')
    expect(xml).toMatch(/<w:tblBorders><w:top w:val="single" w:sz="8"[^]*<w:insideH /)
    expect(xml).toContain('<w:tab w:val="right"')
  })

  test('W1 action table has fixed widths and a header row', () => {
    const xml = documentXml(draftMeetingMinutes(parkMeeting).docx)
    expect(xml).toContain('<w:gridCol w:w="5638"/><w:gridCol w:w="2200"/><w:gridCol w:w="1800"/>')
    expect(xml).toContain('<w:tblHeader/>')
    expect(xml).not.toMatch(/<w:t xml:space="preserve">[^<]*\n/)
  })

  test('meeting-minutes preview checks stay deferred until a render path exists', () => {
    const result = evaluatePreviewChecks(join(office, 'cases/meeting-minutes'))
    expect(result.status).toBe('deferred')
    expect(result.checks).toBe(1)
    expect(result.reason).toContain('#705')
  })
})
