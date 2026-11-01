/**
 * 用捆绑的 OfficeCLI 生成个人办公样例。
 * 运行：OFFICECLI=/path/to/officecli bun scripts/personal-office-samples.ts
 * 样例数字和姓名都是虚构的，只为展示结构和公式。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const officecli = process.env.OFFICECLI ?? '/tmp/officecli-bin/officecli'
const root = join(import.meta.dir, '../apps/electron/resources/skills/office-business/cases')

function run(args: string[]): string {
  const proc = Bun.spawnSync([officecli, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const out = `${proc.stdout.toString()}${proc.stderr.toString()}`.trim()
  if (proc.exitCode !== 0) throw new Error(`officecli ${args.slice(0, 4).join(' ')} failed (${proc.exitCode})\n${out}`)
  return out
}

function fresh(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  rmSync(file, { force: true })
  run(['create', file])
  return file
}

function props(entries: Record<string, string>): string[] {
  return Object.entries(entries).flatMap(([key, value]) => ['--prop', `${key}=${value}`])
}

function paragraph(file: string, text: string, style: Record<string, string> = {}): void {
  run(['add', file, '/body', '--type', 'paragraph', ...props({ text, ...style })])
}

function page(file: string, margins = { top: '2.4cm', bottom: '2.2cm', left: '2.2cm', right: '2.2cm' }): void {
  run(['set', file, '/', ...props({
    pageWidth: '21cm',
    pageHeight: '29.7cm',
    marginTop: margins.top,
    marginBottom: margins.bottom,
    marginLeft: margins.left,
    marginRight: margins.right,
  })])
}

function footer(file: string, label: string): void {
  run(['add', file, '/', '--type', 'footer', ...props({ type: 'default', size: '9pt', font: 'Calibri', text: `${label}    `, field: 'page' })])
  run(['set', file, '/footer[1]/p[1]', '--prop', 'align=center'])
}

const body = { 'font.ea': '宋体', 'font.latin': 'Calibri', size: '12pt', spaceAfter: '6pt' }
/** 与下段同页、段中不分页：标题不孤悬页底，末段正文和落款、签字不拆页 */
const keep = { keepNext: 'true', keepLines: 'true' }
const h1 = { 'font.ea': '黑体', 'font.latin': 'Calibri', size: '16pt', bold: 'true', color: '1F4E79', spaceBefore: '12pt', spaceAfter: '6pt', ...keep }
const title = { 'font.ea': '黑体', 'font.latin': 'Calibri', size: '22pt', bold: 'true', color: '1F4E79', align: 'center', spaceAfter: '4pt', ...keep }
const note = { 'font.ea': '宋体', 'font.latin': 'Calibri', size: '10.5pt', color: '666666', align: 'center', spaceAfter: '10pt' }

function heading(file: string, text: string): void {
  paragraph(file, text, h1)
}

function line(file: string, text: string): void {
  paragraph(file, text, body)
}

/** 末段正文、签字等要和下一段留在同一页的行 */
function lineWithNext(file: string, text: string): void {
  paragraph(file, text, { ...body, ...keep })
}

function table(file: string, rows: string[][], headerFill = '1F4E79'): void {
  const cols = rows[0]!.length
  run(['add', file, '/body', '--type', 'table', ...props({
    rows: String(rows.length),
    cols: String(cols),
    width: '100%',
    'border.all': 'single;4;D0D7E2',
  })])
  rows.forEach((row, index) => {
    const path = `/body/tbl[last()]/tr[${index + 1}]`
    const values = Object.fromEntries(row.map((cell, column) => [`c${column + 1}`, cell]))
    run(['set', file, path, ...props(index === 0 ? { header: 'true', ...values } : values)])
    if (index === 0) {
      for (let column = 1; column <= cols; column += 1) {
        run(['set', file, `${path}/tc[${column}]`, '--prop', `fill=${headerFill}`])
        run(['set', file, `${path}/tc[${column}]/p[1]/r[1]`, ...props({ color: 'FFFFFF', bold: 'true', 'font.ea': '黑体' })])
      }
    }
  })
}

function center(file: string, sheet: string, columns: string, from: number, to: number): void {
  for (const letter of columns) {
    for (let row = from; row <= to; row += 1) {
      run(['set', file, `/${sheet}/${letter}${row}`, '--prop', 'halign=center'])
    }
  }
}

function finish(file: string): void {
  run(['save', file])
  run(['close', file])
  const report = run(['validate', file])
  if (!/no errors/i.test(report) && !/passed/i.test(report)) throw new Error(report)
}

function cell(file: string, sheet: string, address: string, fields: Record<string, string>): void {
  run(['set', file, `/${sheet}/${address}`, ...props(fields)])
}

function col(file: string, sheet: string, letter: string, width: number): void {
  run(['set', file, `/${sheet}/col[${letter}]`, '--prop', `width=${width}`])
}

function workbook(dir: string, name: string, sheet: string): string {
  const file = fresh(dir, name)
  run(['set', file, '/Sheet1', '--prop', `name=${sheet}`])
  return file
}

function writeText(path: string, text: string): void {
  Bun.write(path, text)
}

function houseLease(): void {
  const dir = join(root, 'house-lease')
  const file = fresh(dir, 'example.docx')
  page(file)
  paragraph(file, '房屋租赁合同', title)
  paragraph(file, '虚构样例，仅供版式参考，不构成法律意见', note)
  line(file, '出租人（甲方）：林某，身份事项待补充：证件号')
  line(file, '承租人（乙方）：周某，身份事项待补充：证件号')
  heading(file, '第一条  房屋')
  line(file, '甲方将坐落于北京市朝阳区示例路 8 号 2 室的房屋出租给乙方，用于居住。建筑面积待补充：房产证明载明的数字。')
  heading(file, '第二条  期限')
  line(file, '租期自 2026 年 11 月 1 日起至 2027 年 10 月 31 日止。交付日与房屋现状以双方交接清单为准，清单尚未签署的，写「待补充：交接清单」。')
  heading(file, '第三条  租金与押金')
  table(file, [
    ['项目', '约定'],
    ['月租金', '人民币 6,500 元（陆仟伍佰元整）'],
    ['支付方式', '押一付三'],
    ['押金', '人民币 6,500 元，合同结束且结清费用后返还'],
    ['收款账户', '待补充：户名与账号'],
  ])
  heading(file, '第四条  使用与维修')
  line(file, '乙方不得擅自转租。自然损坏的维修责任待补充：双方确认的范围。乙方造成的损坏由乙方修复。')
  heading(file, '第五条  违约')
  line(file, '逾期支付租金超过五日的，按用户日后确认的方式计收违约金。本样例不填写比例，写「待补充：违约金计算方式」。')
  heading(file, '第六条  解除、争议与签署')
  lineWithNext(file, '提前解除的通知期待补充。争议解决方式待补充：诉讼或仲裁，不在样例中预设城市。本合同一式两份，双方各执一份，自签字之日起生效。')
  lineWithNext(file, '甲方签字：____________    日期：待补充')
  line(file, '乙方签字：____________    日期：待补充')
  footer(file, '房屋租赁合同 · 虚构样例')
  finish(file)
  writeText(join(dir, 'design.md'), `# 房屋租赁合同\n\nWord 样例。展示当事人、标的、期限、价款、违约和争议解决的编号条款。金额和地址是虚构的，账户、证件号、维修范围和违约金计算方式保留为待补充。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli',
    version: '1.0.157',
    script: 'scripts/personal-office-samples.ts',
    prompt: '参考这份房屋租赁合同的条款顺序和版式，用我提供的双方、房屋和租金另写一份。缺的信息标待补充。',
    fictional: true,
  }, null, 2))
}

function resume(): void {
  const dir = join(root, 'product-resume')
  const file = fresh(dir, 'example.docx')
  page(file, { top: '1.7cm', bottom: '1.6cm', left: '1.7cm', right: '1.7cm' })
  paragraph(file, '陈可', { ...title, size: '26pt', spaceAfter: '2pt' })
  paragraph(file, '产品经理  ·  北京  ·  电话与邮箱待补充', note)
  heading(file, '摘要')
  line(file, '四年消费类产品经验，做过从需求到上线的小程序改版。数字只保留材料里有的那一笔：改版后首月留存由 18% 到 27%（虚构样例）。')
  heading(file, '经历')
  line(file, '北窗科技 · 产品经理 · 2022 年 4 月 — 2026 年 9 月')
  line(file, '情境：会员续费路径分散在三个页面。任务：收成一条可解释的开通流程。行动：合并入口，并给客服一份对照说明。结果：首月留存 18% 到 27%（样例数字，不是用户的成绩）。')
  line(file, '更早的雇主、职位和起止日期：待补充。')
  heading(file, '教育')
  line(file, '某大学 · 工业设计 · 2018 年（学校全称待补充）')
  paragraph(file, '求职信', { ...title, size: '20pt', spaceBefore: '18pt', pageBreakBefore: 'true' })
  paragraph(file, '2026 年 11 月 1 日', note)
  line(file, '招聘负责人：')
  line(file, '我申请贵司产品经理岗位。北窗科技期间，我把会员开通从三个页面收成一条路径，首月留存由 18% 到 27%。这次希望把同样的收口方法用到贵司正在改的下单流程上。')
  lineWithNext(file, '方便的话，我可以按贵司指定的时间做一次 30 分钟的说明。薪资期望：待补充。')
  line(file, '陈可')
  footer(file, '简历与求职信 · 虚构样例')
  finish(file)
  writeText(join(dir, 'design.md'), `# 产品经理简历与求职信\n\nWord 样例。简历在前，求职信另起标题。经历用情境、任务、行动、结果，数字标明虚构。身份证、详细住址和未提供的雇主写成待补充。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这份简历和求职信的版式，用我的经历重写。没有的公司、数字和日期标待补充，不要留下样例里的北窗科技。',
  }, null, 2))
}

function travelClaim(): void {
  const dir = join(root, 'travel-claim')
  const file = fresh(dir, 'example.docx')
  page(file)
  paragraph(file, '差旅报销申请表', title)
  paragraph(file, '虚构样例。审批栏保持空白，不代表已经同意', note)
  table(file, [
    ['项目', '填写'],
    ['申请人', '赵某'],
    ['部门', '待补充：部门'],
    ['事由', '客户现场验收（虚构）'],
    ['起止', '2026-11-03 至 2026-11-05'],
    ['交通', '人民币 1,280 元'],
    ['住宿', '人民币 760 元'],
    ['合计', '人民币 2,040 元（贰仟零肆拾元整）'],
    ['附件张数', '待补充'],
    ['申请人签字 / 日期', '待补充'],
  ])
  heading(file, '审批')
  table(file, [
    ['审批人', '意见', '签字', '日期'],
    ['直接主管', '', '', ''],
    ['财务', '', '', ''],
  ], '375623')
  line(file, '必填而未提供的部门、附件张数和签字已标待补充。审批意见不要代填。')
  footer(file, '差旅报销申请 · 虚构样例')
  finish(file)
  writeText(join(dir, 'design.md'), `# 差旅报销申请表\n\nWord 表格。申请人信息、行程和金额在上，审批栏在下且留空。合计与分项一致，未提供的部门标待补充。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这张差旅报销申请表，用我的行程和票据金额另填一份。没给的栏标待补充，审批栏留空。',
  }, null, 2))
}

function invitation(): void {
  const dir = join(root, 'annual-invitation')
  const file = fresh(dir, 'example.docx')
  page(file)
  paragraph(file, '年会邀请函', title)
  paragraph(file, '虚构样例 · 正式语气', note)
  line(file, '尊敬的来宾：')
  line(file, '北窗科技定于 2026 年 12 月 18 日举行年度聚会，诚邀您出席。这是一份版式样例，姓名和酒店都是虚构的。')
  heading(file, '时间与地点')
  line(file, '时间：2026 年 12 月 18 日 18:00 至 21:00。')
  line(file, '地点：北京市朝阳区示例路 18 号示例宴会厅。交通方式待补充。')
  heading(file, '议程')
  table(file, [
    ['时间', '事项', '负责人'],
    ['18:00', '签到', '会务组'],
    ['18:30', '年度回顾', '待补充：主讲人'],
    ['19:10', '晚餐', '会务组'],
    ['20:30', '自由交流', '待补充'],
  ])
  heading(file, '回复')
  lineWithNext(file, '请于 2026 年 12 月 10 日前回复是否出席。回复邮箱待补充。')
  lineWithNext(file, '北窗科技')
  line(file, '2026 年 11 月 1 日')
  footer(file, '年会邀请函 · 虚构样例')
  finish(file)
  writeText(join(dir, 'design.md'), `# 年会邀请函\n\nWord 样例。称呼、时间地点、议程表和回复方式分开。主讲人和回复邮箱保留待补充，不把议程写成已经做出的决定。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这份邀请函的结构和正式语气，按我给的活动、时间和地点另写一封。没定的主讲人或链接标待补充。',
  }, null, 2))
}

function prd(): void {
  const dir = join(root, 'miniapp-prd')
  const file = fresh(dir, 'example.docx')
  page(file)
  paragraph(file, '邻里取件小程序需求说明', title)
  paragraph(file, '虚构样例 · 产品需求文档', note)
  heading(file, '一、背景')
  line(file, '小区快递柜经常满仓，住户要在三个群里问柜子位置。这是样例背景，不是用户的调研结论。')
  heading(file, '二、目标与非目标')
  line(file, '目标：住户能按取件码看到柜子位置和剩余时间。非目标：本次不做支付，不做代取下单。')
  heading(file, '三、用户故事与验收')
  table(file, [
    ['故事', '验收'],
    ['作为住户，我要输入取件码，以便找到柜子', '给定有效取件码，当提交后，则显示柜号；无效码显示「未找到」，不显示别人的包裹'],
    ['作为住户，我要看到超时提醒', '待补充：超时多少小时算超时'],
  ])
  heading(file, '四、里程碑')
  line(file, '范围确认：待补充日期。可用版本：待补充日期。进入标准是验收表里的两条都能被勾成通过或失败。')
  heading(file, '五、待定')
  line(file, '待补充：超时规则由谁确认。')
  footer(file, '产品需求说明 · 虚构样例')
  finish(file)
  writeText(join(dir, 'design.md'), `# 小程序产品需求文档\n\nWord 样例。背景、目标与非目标、用户故事、可失败的验收标准、里程碑和待定分开。没有依据的日期写成待补充。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这份需求说明的章节，为【产品】写一份 Word 需求文档。故事和验收用我的材料，没有的日期标待补充。',
  }, null, 2))
}

function letter(): void {
  const dir = join(root, 'partnership-letter')
  const file = fresh(dir, 'example.docx')
  page(file)
  paragraph(file, 'Lin Mou', { ...title, size: '16pt', align: 'left', spaceAfter: '0pt' })
  paragraph(file, 'Beichuang Technology  ·  Beijing', { ...note, align: 'left' })
  paragraph(file, 'Email: to be confirmed', { ...note, align: 'left', spaceAfter: '12pt' })
  line(file, '1 November 2026')
  line(file, 'Ms Zhou')
  line(file, 'Operations Lead, Hehu Trading')
  line(file, 'Address: to be confirmed')
  line(file, 'Dear Ms Zhou,')
  line(file, 'I am writing to ask whether Hehu Trading would join a one-quarter pilot to share pickup-point capacity in Chaoyang. The figures in this letter are sample figures, not a commitment.')
  line(file, 'We can offer two cabinet locations from 18 November 2026. We would need your written list of participating stores before 20 November 2026. Pricing for the pilot is to be confirmed.')
  lineWithNext(file, 'Please reply if a short call in the week of 10 November 2026 would be useful.')
  lineWithNext(file, 'Yours sincerely,')
  lineWithNext(file, 'Lin Mou')
  line(file, 'Partnerships')
  footer(file, 'Sample business letter')
  finish(file)
  writeText(join(dir, 'design.md'), `# 合作邀约信\n\n英文商务信函样例。发信人、日期、收信人、称呼、分段正文和 Yours sincerely 按正式信函排列。地址和试点价格写 To be confirmed，不用中文「待补充」进入正文。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这封英文信的版式，用我的双方、事由和日期另写一封正式商务信。不知道的姓名和地址写 To be confirmed。',
  }, null, 2))
}

function quotation(): void {
  const dir = join(root, 'equipment-quote')
  const sheet = '报价明细'
  const file = workbook(dir, 'example.xlsx', sheet)
  for (const [letter, width] of [['A', 22], ['B', 12], ['C', 16], ['D', 18], ['E', 18], ['F', 16], ['G', 20]] as const) col(file, sheet, letter, width)
  cell(file, sheet, 'A1', { value: '设备采购报价单', bold: 'true', font: 'Calibri', 'font.size': '20', 'font.color': '1F4E79' })
  cell(file, sheet, 'A2', { value: '虚构样例 · 有效期与账户见下方，未填写的标待补充', font: 'Calibri', 'font.size': '11', 'font.color': '666666' })
  const headers = ['品名', '数量', '单价', '金额', '折后', '税额', '价税合计']
  headers.forEach((label, index) => cell(file, sheet, `${'ABCDEFG'[index]}4`, { value: label, bold: 'true', fill: '1F4E79', 'font.color': 'FFFFFF' }))
  cell(file, sheet, 'A5', { value: '机架服务器' })
  cell(file, sheet, 'B5', { value: '5', fill: 'D6EAF8' })
  cell(file, sheet, 'C5', { value: '32000', fill: 'D6EAF8', numFmt: '#,##0.00' })
  cell(file, sheet, 'A6', { value: '安装调试' })
  cell(file, sheet, 'B6', { value: '1', fill: 'D6EAF8' })
  cell(file, sheet, 'C6', { value: '8000', fill: 'D6EAF8', numFmt: '#,##0.00' })
  for (const row of [5, 6]) {
    cell(file, sheet, `D${row}`, { formula: `B${row}*C${row}`, numFmt: '#,##0.00' })
    cell(file, sheet, `E${row}`, { formula: `D${row}*$B$8`, numFmt: '#,##0.00' })
    cell(file, sheet, `F${row}`, { formula: `E${row}*$B$9`, numFmt: '#,##0.00' })
    cell(file, sheet, `G${row}`, { formula: `E${row}+F${row}`, numFmt: '#,##0.00' })
  }
  cell(file, sheet, 'A7', { value: '合计', bold: 'true' })
  for (const letter of ['D', 'E', 'F', 'G']) cell(file, sheet, `${letter}7`, { formula: `SUM(${letter}5:${letter}6)`, bold: 'true', numFmt: '#,##0.00' })
  cell(file, sheet, 'A8', { value: '折扣系数' })
  cell(file, sheet, 'B8', { value: '0.9', fill: 'D6EAF8', numFmt: '0.00' })
  cell(file, sheet, 'A9', { value: '税率' })
  cell(file, sheet, 'B9', { value: '0.13', fill: 'D6EAF8', numFmt: '0%' })
  cell(file, sheet, 'A11', { value: '报价方' })
  cell(file, sheet, 'B11', { value: '北窗科技（虚构）' })
  cell(file, sheet, 'A12', { value: '客户' })
  cell(file, sheet, 'B12', { value: '待补充：客户名称' })
  cell(file, sheet, 'A13', { value: '有效期' })
  cell(file, sheet, 'B13', { value: '待补充：有效期' })
  cell(file, sheet, 'A14', { value: '付款条件' })
  cell(file, sheet, 'B14', { value: '待补充：付款条件' })
  cell(file, sheet, 'A15', { value: '大写金额' })
  cell(file, sheet, 'B15', { value: '壹拾柒万零捌佰伍拾陆元整（与价税合计核对）' })
  cell(file, sheet, 'A16', { value: '大写核对' })
  cell(file, sheet, 'B16', { formula: 'IF(ABS(G7-170856)<0.01,"大写与价税合计一致","大写待核对")' })
  center(file, sheet, 'BCDEFG', 4, 7)
  center(file, sheet, 'B', 8, 9)
  run(['set', file, `/${sheet}`, '--prop', 'orientation=landscape', '--prop', 'fitToPage=1x1', '--prop', 'printArea=A1:G16'])
  finish(file)
  writeText(join(dir, 'checks.json'), JSON.stringify({
    fictional: true,
    sheet: '报价明细',
    expect: { B8: 0.9, B9: 0.13, D5: 160000, G5: 162720, G7: 170856 },
  }, null, 2))
  writeText(join(dir, 'design.md'), `# 设备采购报价单\n\nExcel 样例。数量和单价是输入，金额、折后、税额和价税合计是公式。折扣 0.9、税率 13% 也在单元格里。客户、有效期和付款条件标待补充。大写金额与价税合计 170,856 元核对。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这张报价单的公式结构，按我给的品名、数量、单价、折扣和税率另做一份。缺的客户和有效期标待补充。',
  }, null, 2))
}

function budget(): void {
  const dir = join(root, 'household-budget')
  const sheet = '收支'
  const file = workbook(dir, 'example.xlsx', sheet)
  for (const [letter, width] of [['A', 16], ['B', 14], ['C', 14], ['D', 14], ['E', 14]] as const) col(file, sheet, letter, width)
  cell(file, sheet, 'A1', { value: '家庭年度预算 · 2026 年 11 月', bold: 'true', 'font.size': '18', 'font.color': '1F4E79' })
  cell(file, sheet, 'A2', { value: '虚构样例，不是理财建议', 'font.color': '666666' })
  ;['科目', '月预算', '本期实际', '偏差', '偏差率'].forEach((label, index) => {
    cell(file, sheet, `${'ABCDE'[index]}4`, { value: label, bold: 'true', fill: '1F4E79', 'font.color': 'FFFFFF' })
  })
  const rows: Array<[string, number, number | string]> = [
    ['工资', 18000, 18000],
    ['其他收入', 2000, 0],
    ['房租', 6500, 6500],
    ['餐饮', 3000, 3480],
    ['交通', 800, 760],
  ]
  rows.forEach((row, index) => {
    const lineNo = 5 + index
    cell(file, sheet, `A${lineNo}`, { value: row[0], fill: index < 2 ? 'E8F6EF' : 'FDEDEC' })
    cell(file, sheet, `B${lineNo}`, { value: String(row[1]), fill: 'D6EAF8', numFmt: '#,##0.00' })
    cell(file, sheet, `C${lineNo}`, { value: String(row[2]), fill: 'D6EAF8', numFmt: '#,##0.00' })
    cell(file, sheet, `D${lineNo}`, { formula: `C${lineNo}-B${lineNo}`, numFmt: '#,##0.00' })
    cell(file, sheet, `E${lineNo}`, { formula: `IF(B${lineNo}=0,"待补充",D${lineNo}/B${lineNo})`, numFmt: '0.0%' })
  })
  cell(file, sheet, 'A11', { value: '收入合计', bold: 'true' })
  cell(file, sheet, 'B11', { formula: 'SUM(B5:B6)', numFmt: '#,##0.00', bold: 'true' })
  cell(file, sheet, 'C11', { formula: 'SUM(C5:C6)', numFmt: '#,##0.00', bold: 'true' })
  cell(file, sheet, 'A12', { value: '支出合计', bold: 'true' })
  cell(file, sheet, 'B12', { formula: 'SUM(B7:B9)', numFmt: '#,##0.00', bold: 'true' })
  cell(file, sheet, 'C12', { formula: 'SUM(C7:C9)', numFmt: '#,##0.00', bold: 'true' })
  cell(file, sheet, 'A13', { value: '结余', bold: 'true' })
  cell(file, sheet, 'C13', { formula: 'C11-C12', numFmt: '#,##0.00', bold: 'true' })
  cell(file, sheet, 'A15', { value: '科目' })
  cell(file, sheet, 'B15', { value: '本期实际' })
  ;['房租', '餐饮', '交通'].forEach((label, index) => {
    cell(file, sheet, `A${16 + index}`, { formula: `A${7 + index}` })
    cell(file, sheet, `B${16 + index}`, { formula: `C${7 + index}`, numFmt: '#,##0.00' })
  })
  run(['add', file, `/${sheet}`, '--type', 'chart', ...props({
    chartType: 'column',
    // 带上 A15:B15 表头：系列名取「本期实际」，类别轴取房租、餐饮、交通；单系列不显示图例
    dataRange: '收支!A15:B18',
    anchor: 'A20:E34',
    title: '支出实际',
    legend: 'none',
  })])
  run(['set', file, `/${sheet}`, '--prop', 'orientation=landscape', '--prop', 'fitToPage=1x1', '--prop', 'printArea=A1:E34'])
  finish(file)
  writeText(join(dir, 'checks.json'), JSON.stringify({
    fictional: true,
    sheet: '收支',
    expect: { C11: 18000, C12: 10740, C13: 7260, D8: 480 },
  }, null, 2))
  writeText(join(dir, 'design.md'), `# 家庭年度预算\n\nExcel 样例。收入和支出分色，偏差和结余是公式，支出实际另有柱形图。数字虚构。改一笔实际数后结余应跟着变。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这张家用预算表的科目、偏差公式和图，用我的收支重做。没有的数标待补充，不要沿用样例金额。',
  }, null, 2))
}

function statement(): void {
  const dir = join(root, 'vendor-statement')
  const sheet = '对账'
  const file = workbook(dir, 'example.xlsx', sheet)
  for (const [letter, width] of [['A', 16], ['B', 20], ['C', 16], ['D', 14], ['E', 16], ['F', 16], ['G', 16]] as const) col(file, sheet, letter, width)
  cell(file, sheet, 'A1', { value: '供应商月度对账单', bold: 'true', 'font.size': '18', 'font.color': '1F4E79' })
  cell(file, sheet, 'A2', { value: '对方：和湖贸易（虚构） · 2026 年 10 月 · 应付', 'font.color': '666666' })
  ;['日期', '发票号', '不含税', '税额', '价税合计', '已付', '差异'].forEach((label, index) => {
    cell(file, sheet, `${'ABCDEFG'[index]}4`, { value: label, bold: 'true', fill: '1F4E79', 'font.color': 'FFFFFF' })
  })
  const lines = [
    ['2026-10-06', '待补充：票号 1', 10000, 1300],
    ['2026-10-18', '待补充：票号 2', 8000, 1040],
    ['2026-10-27', '待补充：票号 3', 5000, 650],
  ]
  lines.forEach((row, index) => {
    const lineNo = 5 + index
    cell(file, sheet, `A${lineNo}`, { value: String(row[0]) })
    cell(file, sheet, `B${lineNo}`, { value: String(row[1]) })
    cell(file, sheet, `C${lineNo}`, { value: String(row[2]), fill: 'D6EAF8', numFmt: '#,##0.00' })
    cell(file, sheet, `D${lineNo}`, { value: String(row[3]), fill: 'D6EAF8', numFmt: '#,##0.00' })
    cell(file, sheet, `E${lineNo}`, { formula: `C${lineNo}+D${lineNo}`, numFmt: '#,##0.00' })
  })
  cell(file, sheet, 'F5', { value: '11300', fill: 'D6EAF8', numFmt: '#,##0.00' })
  cell(file, sheet, 'F6', { value: '9040', fill: 'D6EAF8', numFmt: '#,##0.00' })
  cell(file, sheet, 'F7', { value: '0', fill: 'D6EAF8', numFmt: '#,##0.00' })
  for (const row of [5, 6, 7]) cell(file, sheet, `G${row}`, { formula: `E${row}-F${row}`, numFmt: '#,##0.00' })
  cell(file, sheet, 'A8', { value: '合计', bold: 'true' })
  for (const letter of ['C', 'D', 'E', 'F', 'G']) cell(file, sheet, `${letter}8`, { formula: `SUM(${letter}5:${letter}7)`, bold: 'true', numFmt: '#,##0.00' })
  cell(file, sheet, 'A10', { value: '期初应付' })
  cell(file, sheet, 'B10', { value: '待补充：期初', fill: 'D6EAF8' })
  run(['add', file, `/${sheet}`, '--type', 'conditionalformatting', ...props({ type: 'cellIs', operator: 'notEqual', value: '0', ref: 'G5:G7', fill: 'F5B7B1' })])
  center(file, sheet, 'ABCDEFG', 4, 8)
  run(['set', file, `/${sheet}`, '--prop', 'orientation=landscape', '--prop', 'fitToPage=1x1', '--prop', 'printArea=A1:G10'])
  finish(file)
  writeText(join(dir, 'checks.json'), JSON.stringify({
    fictional: true,
    sheet: '对账',
    expect: { E5: 11300, G5: 0, G7: 5650, G8: 5650 },
  }, null, 2))
  writeText(join(dir, 'design.md'), `# 供应商月度对账单\n\nExcel 样例。价税合计和差异是公式。第三笔未付款，差异用条件格式标出。发票号和期初写成待补充，不编造票号。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这张对账单的列和差异公式，用我的发票和付款重做。缺票号就标待补充，不要沿用样例金额。',
  }, null, 2))
}

function excelSerial(iso: string): number {
  const day = Date.parse(`${iso}T00:00:00Z`)
  const epoch = Date.parse('1899-12-30T00:00:00Z')
  return Math.round((day - epoch) / 86400000)
}

function gantt(): void {
  const dir = join(root, 'project-gantt')
  const sheet = '计划'
  const file = workbook(dir, 'example.xlsx', sheet)
  col(file, sheet, 'A', 18)
  col(file, sheet, 'B', 14)
  col(file, sheet, 'C', 12)
  col(file, sheet, 'D', 14)
  for (const letter of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) col(file, sheet, letter, 11)
  cell(file, sheet, 'A1', { value: '三个月项目计划', bold: 'true', 'font.size': '18', 'font.color': '1F4E79' })
  cell(file, sheet, 'A2', { value: '虚构样例 · 工期按自然日 · 结束日 = 开始日 + 工期 - 1', 'font.color': '666666' })
  cell(file, sheet, 'A3', { value: '项目开始' })
  cell(file, sheet, 'B3', { value: String(excelSerial('2026-11-02')), numFmt: 'yyyy-mm-dd', fill: 'D6EAF8' })
  ;['任务', '开始', '工期（天）', '结束'].forEach((label, index) => {
    cell(file, sheet, `${'ABCD'[index]}5`, { value: label, bold: 'true', fill: '1F4E79', 'font.color': 'FFFFFF' })
  })
  const tasks = [
    ['需求确认', '2026-11-02', 10],
    ['方案设计', '2026-11-12', 14],
    ['开发', '2026-11-26', 28],
    ['联调', '2026-12-24', 14],
    ['试运行', '2027-01-07', 14],
    ['验收', '2027-01-21', 7],
  ]
  tasks.forEach((task, index) => {
    const row = 6 + index
    cell(file, sheet, `A${row}`, { value: String(task[0]) })
    cell(file, sheet, `B${row}`, { value: String(excelSerial(String(task[1]))), numFmt: 'yyyy-mm-dd', fill: 'D6EAF8' })
    cell(file, sheet, `C${row}`, { value: String(task[2]), fill: 'D6EAF8' })
    cell(file, sheet, `D${row}`, { formula: `B${row}+C${row}-1`, numFmt: 'yyyy-mm-dd' })
  })
  const weeks = 'EFGHIJKL'.split('')
  weeks.forEach((letter, index) => {
    cell(file, sheet, `${letter}5`, { formula: `$B$3+${index * 7}`, numFmt: 'mm/dd', bold: 'true', fill: '1F4E79', 'font.color': 'FFFFFF' })
    for (let row = 6; row <= 11; row += 1) {
      cell(file, sheet, `${letter}${row}`, { formula: `IF(AND(${letter}$5<=$D${row},${letter}$5+6>=$B${row}),1,0)` })
    }
  })
  run(['add', file, `/${sheet}`, '--type', 'conditionalformatting', ...props({
    type: 'dataBar', ref: 'E6:L11', color: '1F4E79', min: '0', max: '1',
  })])
  center(file, sheet, 'ABCD', 5, 11)
  center(file, sheet, 'EFGHIJKL', 5, 11)
  run(['set', file, `/${sheet}`, '--prop', 'orientation=landscape', '--prop', 'fitToPage=1x1', '--prop', 'printArea=A1:L11'])
  finish(file)
  writeText(join(dir, 'checks.json'), JSON.stringify({
    fictional: true,
    sheet: '计划',
    note: '结束日比开始日多工期减一天。需求确认工期 10，结束日应为 2026-11-11。',
  }, null, 2))
  writeText(join(dir, 'design.md'), `# 三个月项目计划\n\nExcel 样例。开始日和工期是输入，结束日和每周是否覆盖由公式计算，覆盖格用数据条显示。任务和日期都是虚构的。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这份项目计划的工期公式和周视图，用我的任务、开始日和工期另做一张表。不知道的负责人标待补充。',
  }, null, 2))
}

function okr(): void {
  const dir = join(root, 'quarterly-okr')
  const sheet = '考核'
  const file = workbook(dir, 'example.xlsx', sheet)
  for (const [letter, width] of [['A', 26], ['B', 40], ['C', 12], ['D', 10], ['E', 12]] as const) col(file, sheet, letter, width)
  cell(file, sheet, 'A1', { value: '2026 年第四季度目标考核表', bold: 'true', 'font.size': '18', 'font.color': '1F4E79' })
  cell(file, sheet, 'A2', { value: '对象：产品组（虚构） · 评分 1 至 5 · 权重为小数', 'font.color': '666666' })
  ;['目标', '关键结果', '权重', '评分', '加权'].forEach((label, index) => {
    cell(file, sheet, `${'ABCDE'[index]}4`, { value: label, bold: 'true', fill: '1F4E79', 'font.color': 'FFFFFF' })
  })
  const rows = [
    ['把取件路径收成一页', '有效取件码能显示柜号', 0.4, 4],
    ['把取件路径收成一页', '无效码不显示他人包裹', 0.35, 3],
    ['按时交付可验收版本', '验收条目均可被判定通过或失败', 0.25, 5],
  ]
  rows.forEach((row, index) => {
    const lineNo = 5 + index
    cell(file, sheet, `A${lineNo}`, { value: String(row[0]), fill: index === 0 ? 'EAF2F8' : 'FFFFFF' })
    cell(file, sheet, `B${lineNo}`, { value: String(row[1]) })
    cell(file, sheet, `C${lineNo}`, { value: String(row[2]), fill: 'D6EAF8', numFmt: '0%' })
    cell(file, sheet, `D${lineNo}`, { value: String(row[3]), fill: 'D6EAF8' })
    cell(file, sheet, `E${lineNo}`, { formula: `C${lineNo}*D${lineNo}`, numFmt: '0.00' })
  })
  cell(file, sheet, 'A8', { value: '合计', bold: 'true' })
  cell(file, sheet, 'C8', { formula: 'SUM(C5:C7)', bold: 'true', numFmt: '0%' })
  cell(file, sheet, 'E8', { formula: 'SUM(E5:E7)', bold: 'true', numFmt: '0.00' })
  cell(file, sheet, 'A9', { value: '权重校验' })
  cell(file, sheet, 'B9', { formula: 'IF(ABS(C8-1)<0.001,"权重合计为 100%","权重合计应为 100%，当前待核对")' })
  center(file, sheet, 'CDE', 4, 8)
  run(['set', file, `/${sheet}`, '--prop', 'orientation=landscape', '--prop', 'fitToPage=1x1', '--prop', 'printArea=A1:E9'])
  finish(file)
  writeText(join(dir, 'checks.json'), JSON.stringify({
    fictional: true,
    sheet: '考核',
    expect: { C8: 1, E5: 1.6, E8: 3.9 },
  }, null, 2))
  writeText(join(dir, 'design.md'), `# 季度目标考核表\n\nExcel 样例。权重和评分是输入，加权和权重合计是公式。校验格在权重合计为 100% 时给出明确文字。目标和分数都是虚构的。\n`)
  writeText(join(dir, 'generation.json'), JSON.stringify({
    tool: 'officecli', version: '1.0.157', script: 'scripts/personal-office-samples.ts', fictional: true,
    prompt: '参考这张考核表的权重、评分和加权公式，用我的目标和分数重做。没给的评分留空，不要沿用样例分数。',
  }, null, 2))
}

const builders = [houseLease, resume, travelClaim, invitation, prd, letter, quotation, budget, statement, gantt, okr]
const only = new Set(process.argv.slice(2))
for (const build of builders.filter(item => only.size === 0 || only.has(item.name))) {
  build()
  console.log('ok', build.name)
}
