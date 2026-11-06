/** Selection 自编中文模板。借鉴七类文档的层级与配色，不复制参考正文、图片或品牌。开发时运行，生成时不运行。 */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { buildDocx, unzip, zipStore, type DocBlock } from '../packages/office-business-runtime/src/docx-package'

const root = join(import.meta.dir, '../apps/electron/resources/skills/office-business')
const specs = [
  { id: 'design-report', title: '设计报告', color: '171717', tint: 'F3F1ED', label: 'DESIGN REPORT', sections: ['执行摘要', '背景与问题', '关键发现', '建议与下一步'], use: '产品设计、用户研究、视觉与体验报告', serif: false },
  { id: 'experiment-analysis', title: '实验分析', color: '18783C', tint: 'EDF5EF', label: 'EXPERIMENT ANALYSIS', sections: ['研究摘要', '假设与方法', '结果与分析', '局限与结论'], use: '实验、评测、数据分析与研究报告', serif: true },
  { id: 'investment-memo', title: '投资备忘录', color: '202020', tint: 'F2F3F5', label: 'INVESTMENT MEMO', sections: ['决策摘要', '投资逻辑', '关键假设与风险', '建议与条件'], use: '投资评估、融资、估值与投委会材料', serif: false },
  { id: 'legal-memo', title: '法律备忘录', color: '292929', tint: 'F4F4F4', label: 'LEGAL MEMORANDUM', sections: ['事项与问题', '事实背景', '分析与依据', '结论与待确认事项'], use: '法律问题分析、合规与法律备忘录；不替代用户合同原件', serif: true },
  { id: 'minimal-letter', title: '简约信笺', color: 'C65D24', tint: 'FCF4EC', label: 'CORRESPONDENCE', sections: ['称谓', '正文', '落款'], use: '书信、申请、说明与简短函件', serif: false },
  { id: 'strategy-memo', title: '战略备忘录', color: '192B85', tint: 'EEF0FB', label: 'STRATEGY MEMO', sections: ['核心建议', '背景与目标', '方案比较', '执行与衡量'], use: '战略选择、经营决策、方案比较与行动建议', serif: false },
  { id: 'system-design', title: '系统设计', color: '153959', tint: 'EAF2F8', label: 'SYSTEM DESIGN', sections: ['摘要', '背景与目标', '方案与关键设计', '权衡、风险与下一步'], use: '技术报告、架构、工程方案及未明确分类的专业报告', serif: false },
]
const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'))
catalog.cases = catalog.cases.filter((entry: { id: string }) => !specs.some(s => entry.id === `style-${s.id}`))
for (const s of specs) {
  const id = `style-${s.id}`
  const dir = join(root, 'cases', id)
  mkdirSync(dir, { recursive: true })
  const centered = ['experiment-analysis', 'legal-memo', 'strategy-memo'].includes(s.id)
  const blocks: DocBlock[] = [
    { kind: 'p', text: s.label, align: centered ? 'center' : 'left', sizeHalfPoints: 18, color: s.color, spaceAfter: 280, ruleBelow: s.color, keepNext: true },
    { kind: 'p', text: '【文档标题】', style: 'Title', align: centered ? 'center' : 'left', sizeHalfPoints: s.id === 'design-report' ? 60 : s.serif ? 48 : 52, color: s.color, bold: true, spaceAfter: 160, keepNext: true },
    { kind: 'p', text: '【副标题或范围说明】', align: centered ? 'center' : 'left', sizeHalfPoints: 23, color: '596675', spaceAfter: 160, keepNext: true },
    { kind: 'p', text: '【作者／团队 · 日期】', align: centered ? 'center' : 'left', sizeHalfPoints: 18, color: '6B7280', spaceAfter: 360 },
  ]
  for (const [i, heading] of s.sections.entries()) {
    if (s.id === 'minimal-letter') {
      blocks.push({ kind: 'p', text: `【${heading}内容】`, spaceBefore: i === 2 ? 360 : 120, spaceAfter: 160 })
      continue
    }
    blocks.push({ kind: 'p', text: heading, style: 'Heading1', color: s.color, bold: true, spaceBefore: 260, spaceAfter: 140 })
    blocks.push({ kind: 'p', text: `【${heading}内容】` })
    if (i === 1 && !['minimal-letter', 'legal-memo'].includes(s.id)) {
      blocks.push({ kind: 'p', text: '【分析要点】', style: 'Heading2', color: s.color, bold: true })
      blocks.push({ kind: 'p', text: '【要点说明；可按需克隆此段或移除】' })
      blocks.push({ kind: 'table', rows: [['项目', '分析与依据', '影响／行动'], ['【项目】', '【分析】', '【行动】']], widths: [1800, 4200, 3026], header: true, borders: 'grid' })
    }
  }
  if (s.id !== 'minimal-letter') blocks.push({ kind: 'p', text: '【来源或附注】', sizeHalfPoints: 18, color: '6B7280', spaceBefore: 260 })
  const parts = unzip(buildDocx(blocks, { marginTop: 1200, marginBottom: 1200, marginLeft: 1440, marginRight: 1440 }))
  const patch = (path: string, change: (xml: string) => string) => parts.set(path, Buffer.from(change(parts.get(path)!.toString())))
  const ea = s.serif ? '宋体' : '微软雅黑'
  const latin = s.serif ? 'Cambria' : 'Calibri'
  patch('word/styles.xml', xml => xml.replace('<w:lang', `<w:rFonts w:ascii="${latin}" w:hAnsi="${latin}" w:eastAsia="${ea}"/><w:color w:val="24292F"/><w:lang`).replace('w:line="259"', 'w:line="340"').replace('w:sz w:val="21"', 'w:sz w:val="22"'))
  patch('word/document.xml', xml => xml.replaceAll('w:fill="EDEFF2"', `w:fill="${s.tint}"`).replaceAll('w:color="000000"', 'w:color="DCE2E8"').replace('<w:sectPr>', '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>'))
  parts.set('word/footer1.xml', Buffer.from(`<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${s.label}   ·   </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`))
  patch('[Content_Types].xml', xml => xml.replace('</Types>', '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'))
  patch('word/_rels/document.xml.rels', xml => xml.replace('</Relationships>', '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'))
  const bytes = zipStore([...parts].map(([name, data]) => ({ name, data })))
  writeFileSync(join(dir, 'example.docx'), bytes)
  writeFileSync(join(dir, 'design.md'), `# ${s.title}\n\nSelection 自编模板，参考 ${s.label} 类型的排版层级。用途：${s.use}。\n\n保留模板字体、配色、页边距、页脚与表格。不是参考模板的逐像素复刻；不附带其照片、示例事实或品牌。\n\n替换所有【占位符】；按用户要求重命名章节，删除无关且 can_remove=true 的段落，additions 继承正文或标题样式，row_additions 扩展表格。不要为填满结构编造事实。普通报告不强制独立封面或目录。\n\n一次 office_template_write 成功后直接交付，不再 validate、渲染或视觉复审。\n`)
  catalog.cases.push({ id, title: s.title, titleEn: s.label, mode: 'word', sampleFile: 'example.docx', revision: '20261105.1', category: '文档样式', autoSelect: true, description: s.use, guidance: `参考本模板的标题层级、字体配色、段落间距、表格与页脚，按用户材料组织章节，不照搬模板示例。全部占位符替换为真实内容；缺少的必要事实写「待补充」，无关章节按需删除，用户这次的要求优先。`, businessSkills: [], source: `cases/${id}`, previewCount: 1, selection: { assetDir: `cases/${id}`, exampleSha256: createHash('sha256').update(bytes).digest('hex') } })
}
writeFileSync(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')

// Optional development-only visual QA. Requires LibreOffice + Poppler and suitable
// CJK fonts. Never run this during document creation or application startup.
if (process.argv.includes('--previews')) {
  const scratch = mkdtempSync(join(tmpdir(), 'selection-style-previews-'))
  try {
    for (const spec of specs) {
      const id = `style-${spec.id}`
      const dir = join(root, 'cases', id)
      const preview = join(dir, 'preview')
      mkdirSync(preview, { recursive: true })
      execFileSync('soffice', [`-env:UserInstallation=file://${join(scratch, 'lo')}`, '--headless', '--convert-to', 'pdf', '--outdir', scratch, join(dir, 'example.docx')], { stdio: 'pipe' })
      execFileSync('pdftoppm', ['-scale-to', '1000', '-png', '-singlefile', join(scratch, 'example.pdf'), join(preview, '1')], { stdio: 'pipe' })
      await sharp(join(preview, '1.png')).resize({ width: 480 }).webp({ quality: 85 }).toFile(join(root, '../../../src/renderer/assets/office-covers', `${id}.webp`))
    }
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}
