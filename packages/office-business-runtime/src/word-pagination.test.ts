import { describe, expect, test } from 'bun:test'
import { buildDocx, documentXml, unzip, type DocBlock } from './docx-package.ts'
import { draftGovernmentNotice, draftMeetingMinutes, keepTailTogether, type MeetingRecord } from './word-drafts.ts'

const meeting: MeetingRecord = {
  title: '园区门禁改造会议纪要',
  info: '会议名称：园区门禁改造会。主持人：周宁。会议日期待确认。',
  arrangements: '已定：先改造北门人行闸机，车库入口维持现状。',
  topics: [
    { title: '议题一：北门范围', discussion: '周宁说明北门高峰排队。', decision: '已定先改北门。' },
    { title: '议题二：权限分组', discussion: '访客是否当天失效尚未统一。', decision: '待确认：访客失效时点。' },
  ],
  actions: [{ task: '提交北门方案', owner: '周宁', deadline: '2026-11-06', deliverable: '一页示意图', source: '周宁当场认领' }],
  pending: ['会议日期待确认'],
  suggestions: '整理建议：把访客规则和公告分开跟踪。',
}

/** 按顺序取正文段落（含表格内段落），返回 [pPr, 文本] */
function paragraphs(xml: string): Array<{ pPr: string; text: string }> {
  return [...xml.matchAll(/<w:p>(?:<w:pPr>([\s\S]*?)<\/w:pPr>)?([\s\S]*?)<\/w:p>/g)].map(match => ({
    pPr: match[1] ?? '',
    text: [...(match[2] ?? '').matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(item => item[1]).join(''),
  }))
}

function find(xml: string, text: string) {
  const hit = paragraphs(xml).find(item => item.text === text)
  if (!hit) throw new Error(`找不到段落：${text}`)
  return hit
}

describe('Word 草稿兼容模式与分页', () => {
  test('每份新生成的 DOCX 都声明 compatibilityMode 15，Word 不进兼容性模式', () => {
    for (const docx of [
      buildDocx([{ kind: 'p', text: '空白' }], { marginTop: 1440, marginRight: 1440, marginBottom: 1440, marginLeft: 1440 }),
      draftMeetingMinutes(meeting).docx,
      draftGovernmentNotice({ issuerName: '滨江市城市管理局', subject: '开展市容环境整治', year: 2026 }),
    ]) {
      const files = unzip(docx)
      const settings = files.get('word/settings.xml')?.toString('utf8') ?? ''
      expect(settings).toMatch(/<w:compatSetting w:name="compatibilityMode" w:uri="http:\/\/schemas\.microsoft\.com\/office\/word" w:val="15"\/>/)
      expect(files.get('word/_rels/document.xml.rels')!.toString('utf8')).toContain('relationships/settings" Target="settings.xml"')
      expect(files.get('[Content_Types].xml')!.toString('utf8')).toContain('PartName="/word/settings.xml"')
      // 分页不依赖 Word 默认模板：显式写出段落默认值和孤行控制
      expect(files.get('word/styles.xml')!.toString('utf8')).toContain('<w:pPrDefault><w:pPr><w:widowControl/>')
    }
  })

  test('标题样式与下段同页、段中不分页', () => {
    const styles = unzip(draftMeetingMinutes(meeting).docx).get('word/styles.xml')!.toString('utf8')
    for (const id of ['Title', 'Heading1', 'Heading2']) {
      expect(styles).toMatch(new RegExp(`w:styleId="${id}">[^]*?<w:pPr><w:keepNext/><w:keepLines/>`))
    }
  })

  test('纪要末节整节同页：「整理建议」不会单独落到下一页', () => {
    const xml = documentXml(draftMeetingMinutes(meeting).docx)
    for (const text of ['五、后续确认', '待确认事项', '会议日期待确认', '整理建议']) {
      expect(find(xml, text).pPr).toContain('<w:keepNext/>')
    }
    expect(find(xml, '整理建议：把访客规则和公告分开跟踪。').pPr).toContain('<w:keepLines/>')
    // 讨论与已定一组
    expect(find(xml, '讨论：周宁说明北门高峰排队。').pPr).toContain('<w:keepNext/>')
    // 表格单元格不继承正文段后距
    expect(xml).toContain('<w:tc><w:tcPr><w:tcW w:w="5638" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EDEFF2"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>')
  })

  test('末节太长时不强行整节同页', () => {
    const blocks: DocBlock[] = Array.from({ length: 8 }, (_, index) => ({ kind: 'p' as const, text: `第 ${index} 段` }))
    keepTailTogether(blocks, 0)
    expect(blocks.some(block => block.kind === 'p' && block.keepNext)).toBe(false)
  })

  test('公文落款不单独成页，版记浮动在末页版心底部', () => {
    const xml = documentXml(draftGovernmentNotice({ issuerName: '滨江市城市管理局', subject: '开展市容环境整治', year: 2026, contactName: '待补充' }))
    const last = find(xml, '联系人为待补充。报送期限为【待补充：报送期限】，报送渠道为【待补充：报送渠道】。')
    expect(last.pPr).toContain('<w:keepNext/><w:keepLines/>')
    expect(find(xml, '滨江市城市管理局').pPr).toContain('<w:keepNext/><w:keepLines/>')
    expect(find(xml, '【待补充：成文日期】').pPr).toContain('<w:keepLines/>')
    // 层次标题用 Heading1 样式，靠样式的与下段同页带上末段
    expect(find(xml, '四、信息报送').pPr).toContain('<w:pStyle w:val="Heading1"/>')
    expect(xml).toMatch(/<w:tblPr><w:tblpPr [^>]*w:vertAnchor="margin"[^>]*w:tblpYSpec="bottom"\/><w:tblOverlap w:val="never"\/><w:tblW w:w="8845"/)
    // 版记之后有锚点段落，表格不是正文最后一个元素
    expect(xml).toMatch(/<\/w:tbl><w:p>[^]*<\/w:p><w:sectPr>/)
  })
})
