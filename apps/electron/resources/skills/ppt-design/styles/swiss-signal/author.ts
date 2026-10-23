import { chart, chrome, makeDeck, makePage, panel, rule, text } from '../kit.ts'
import type { Deck, DeckElement, Theme } from '../../engine/types.ts'

export const swissTheme: Theme = {
  id: 'swiss-signal',
  name: 'Swiss Signal',
  margin: 48,
  colors: {
    ink: '#111111',
    paper: '#F5F3EE',
    muted: '#5C5A55',
    accent: '#C41628',
    line: '#CBC8C0',
    surface: '#E8E5DE',
    inverse: '#FFFFFF',
  },
  fonts: {
    cjk: { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
    latin: { mac: 'Helvetica Neue', win: 'Arial', linux: 'Noto Sans' },
  },
  type: {
    display: { min: 44, max: 84 },
    title: { min: 28, max: 36 },
    body: { min: 16, max: 22 },
    caption: { min: 11, max: 14 },
  },
  source: 'Original Swiss signal system. Typographic scale informed by Zara Zhang raw-grid (MIT, e5e204fb): hard edges, system sans, oversized numerals. No third-party logo or template file is embedded.',
}

const SRC = '示例 · 非真实经营记录'

function content(kicker: string, title: string, source: string, pageNo: string, extra: DeckElement[]): DeckElement[] {
  return [...chrome({ kicker, title, source, pageNo }), ...extra]
}

export function buildSwissDeck(): Deck {
  return makeDeck('邻里方药房 · 履约与开店', swissTheme, [
    cover(),
    conclusion(),
    trend(),
    tree(),
    matrix(),
    waterfall(),
    scorecard(),
    gantt(),
    cases(),
    architecture(),
    funnel(),
    closing(),
  ])
}

function cover(): ReturnType<typeof makePage> {
  return makePage('01-cover', 'cover', '封面', '$paper', [
    panel('rail', 0, 0, 14, 540, '$ink', 'decoration'),
    panel('mark', 48, 46, 56, 6, '$accent', 'decoration'),
    text('kicker', '邻里方药房 · 2026 Q1', 48, 64, 460, 24, 15, { bold: true }),
    text('meta', '内部研讨', 640, 64, 272, 24, 15, { color: '$muted', align: 'right' }),
    text('title', '先把履约做稳\n再决定开新店', 48, 112, 520, 132, 46, { bold: true, leading: 1.08 }),
    text('deck', '新店会复制分拣超时。先改滨江店的晚班。', 48, 268, 500, 36, 18),
    panel('metric', 600, 112, 312, 268, '$accent'),
    text('metric-label', '承诺内送达', 624, 136, 264, 24, 15, { bold: true, color: '$inverse' }),
    text('metric-value', '96.4%', 624, 172, 264, 84, 64, { bold: true, color: '$inverse', family: '$latin', valign: 'middle' }),
    text('metric-note', '目标至少 97%。\n缺口在分拣，不在干线。', 624, 268, 264, 72, 16, { color: '$inverse', leading: 1.3 }),
    panel('band', 0, 420, 960, 120, '$ink'),
    text('band-line', '下一步只核对滨江店三个晚班的分拣超时。', 48, 448, 760, 32, 20, { color: '$inverse' }),
    text('source', `${SRC} · 工单归类`, 48, 492, 680, 24, 12, { color: '$surface' }),
    text('page-no', '01', 820, 492, 92, 24, 14, { bold: true, color: '$inverse', align: 'right', family: '$latin' }),
  ], '封面主张：先稳住履约，再决定开店。示例数据。')
}

function conclusion(): ReturnType<typeof makePage> {
  const rows = [
    ['01', '98.1%', '干线准点', '高于 98% 的保持线'],
    ['02', '63%', '分拣占延误', '延误的主要来源'],
    ['03', '91.4%', '末端一次送达', '不是当前第一缺口'],
  ]
  const extra: DeckElement[] = [
    text('claim-label', '当前主张', 48, 124, 380, 22, 13, { bold: true, color: '$accent' }),
    text('claim', '干线已经稳在 98% 以上。\n新店会把分拣问题再复制一遍。', 48, 154, 390, 88, 22, { bold: true, leading: 1.25 }),
    rule('claim-rule', 48, 258, 360, 1, '$ink', 1.25),
    text('implication', '先做滨江晚班试验，两周后再决定开店。', 48, 276, 390, 64, 18, { leading: 1.35 }),
  ]
  rows.forEach((row, index) => {
    const y = 124 + index * 112
    extra.push(
      text(`n-${index}`, row[0]!, 470, y, 56, 28, 14, { color: '$muted', family: '$latin' }),
      text(`v-${index}`, row[1]!, 530, y - 4, 180, 48, 32, { bold: true, family: '$latin' }),
      text(`h-${index}`, row[2]!, 720, y, 192, 28, 18, { bold: true }),
      text(`d-${index}`, row[3]!, 720, y + 34, 192, 28, 14, { color: '$muted' }),
      rule(`r-${index}`, 470, y + 84, 442, 1),
    )
  })
  return makePage('02-conclusion', 'conclusion', '结论', '$paper', content('02  /  结论', '扩店之前，先处理分拣超时', `${SRC} · 干线、分拣、末端拆分`, '02', extra), '结论：先处理分拣，再谈开店。')
}

function trend(): ReturnType<typeof makePage> {
  return makePage('03-trend', 'trend', '趋势', '$paper', content('03  /  趋势', '第 5 周延误约为基线的两倍', `${SRC} · 周延误单，基线取第 2–3 周`, '03', [
    chart('trend-chart', 48, 124, 548, 340, {
      kind: 'line',
      categories: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
      series: [{ name: '延误单', values: [42, 46, 44, 71, 88, 80, 51, 48] }],
      colors: ['$accent'],
    }),
    rule('split', 624, 124, 2, 340, '$ink', 1.5),
    text('delta', '+100%', 652, 140, 248, 72, 52, { bold: true, color: '$accent', family: '$latin' }),
    text('week', '第 5 周 88 单', 652, 222, 248, 32, 18, { bold: true }),
    text('read', '基线是第 2–3 周的 44 单。\n第 4 周起升，第 7 周回到 51。', 652, 268, 248, 88, 16, { leading: 1.35 }),
    text('ask', '先查第 4 周晚班，而不是全网运力。', 652, 372, 248, 64, 16, { color: '$muted', leading: 1.35 }),
  ]), '趋势：第 5 周是基线的两倍，第 7 周已回落。')
}

function tree(): ReturnType<typeof makePage> {
  const branches = [
    ['干线准点 98.1%', '高于保持线，不是主因'],
    ['末端送达 91.4%', '有缺口，但只占延误 16%'],
    ['分拣占延误 63%', '集中在晚班，滨江店最明显'],
  ]
  const extra: DeckElement[] = [
    panel('root', 48, 176, 246, 196, '$ink'),
    text('root-copy', '分拣超时\n占全部延误\n63%', 72, 204, 198, 140, 28, { bold: true, color: '$inverse', leading: 1.2 }),
    rule('spine', 328, 174, 2, 226, '$ink', 1.5),
    rule('root-link', 294, 270, 36, 2, '$ink', 1.5),
  ]
  branches.forEach((branch, index) => {
    const y = 128 + index * 112
    extra.push(
      panel(`leaf-${index}`, 392, y, 520, 96, '$surface'),
      text(`leaf-h-${index}`, branch[0]!, 412, y + 16, 480, 32, 20, { bold: true }),
      text(`leaf-d-${index}`, branch[1]!, 412, y + 52, 480, 28, 16, { color: '$muted' }),
      rule(`leaf-link-${index}`, 330, y + 46, 62, 2, '$ink', 1.5),
    )
  })
  return makePage('04-evidence-tree', 'evidence-tree', '证据树', '$paper', content('04  /  证据', '延误来自分拣，不是干线', `${SRC} · 延误按环节归类，合计 100%`, '04', extra), '证据树：分拣 63%，末端 16%，其余在干线之外的零星项。')
}

function matrix(): ReturnType<typeof makePage> {
  const cells = [
    { id: 'tl', x: 48, y: 124, fill: '$surface', ink: '$ink', muted: '$muted', k: '高影响 · 低可控', h: '干线运力', d: '依赖承运商' },
    { id: 'tr', x: 336, y: 124, fill: '$accent', ink: '$inverse', muted: '$inverse', k: '高影响 · 高可控', h: '滨江晚班排班', d: '店长两周内能改' },
    { id: 'bl', x: 48, y: 300, fill: '$surface', ink: '$ink', muted: '$muted', k: '低影响 · 低可控', h: '包装文案', d: '先不要动' },
    { id: 'br', x: 336, y: 300, fill: '$surface', ink: '$ink', muted: '$muted', k: '低影响 · 高可控', h: '货架陈列', d: '放进日常班次' },
  ]
  const extra: DeckElement[] = cells.flatMap(cell => [
    panel(cell.id, cell.x, cell.y, 272, 160, cell.fill),
    text(`${cell.id}-k`, cell.k, cell.x + 16, cell.y + 16, 240, 22, 13, { bold: true, color: cell.muted }),
    text(`${cell.id}-h`, cell.h, cell.x + 16, cell.y + 48, 240, 40, 22, { bold: true, color: cell.ink }),
    text(`${cell.id}-d`, cell.d, cell.x + 16, cell.y + 100, 240, 36, 16, { color: cell.muted }),
  ])
  extra.push(
    text('axis', '纵轴是影响，横轴是可控。', 632, 124, 280, 48, 16, { color: '$muted', leading: 1.35 }),
    text('next-k', '建议', 632, 186, 280, 22, 13, { bold: true, color: '$accent' }),
    text('next', '先改滨江晚班', 632, 214, 280, 72, 28, { bold: true, leading: 1.15 }),
    text('why', '只动一个店长就能改的变量。\n运力和文案这次不进试验。', 632, 300, 280, 96, 16, { leading: 1.4 }),
  )
  return makePage('05-matrix', 'matrix', '矩阵', '$paper', content('05  /  取舍', '先改高影响、又改得动的事', `${SRC} · 影响与可控为内部判断`, '05', extra), '矩阵：优先滨江晚班，干线运力只观察。')
}

function waterfall(): ReturnType<typeof makePage> {
  return makePage('06-waterfall', 'waterfall', '瀑布', '$paper', content('06  /  瀑布', '毛利从 22.0% 收到 14.0%', `${SRC} · 百分点桥，四项变化轧平到 −8.0`, '06', [
    chart('bridge', 48, 128, 548, 336, {
      kind: 'waterfall',
      categories: ['起点', '运费', '损耗', '折扣', '结构', '期末'],
      series: [{ name: '毛利率', values: [22, -3.2, -2.4, -1.6, -0.8, 14] }],
    }),
    text('net-k', '净变化', 640, 132, 260, 22, 13, { bold: true, color: '$accent' }),
    text('net', '−8.0', 640, 158, 260, 72, 56, { bold: true, family: '$latin' }),
    text('net-u', '个百分点', 640, 232, 260, 28, 16, { color: '$muted' }),
    text('b1', '运费  −3.2', 640, 280, 260, 28, 18, { bold: true }),
    text('b2', '损耗  −2.4', 640, 314, 260, 28, 18),
    text('b3', '折扣  −1.6', 640, 348, 260, 28, 18),
    text('b4', '结构  −0.8', 640, 382, 260, 28, 18),
    text('b5', '最大的一块是运费。', 640, 424, 260, 32, 16, { color: '$muted' }),
  ]), '瀑布：22.0 −3.2 −2.4 −1.6 −0.8 = 14.0。')
}

function scorecard(): ReturnType<typeof makePage> {
  const rows = [
    ['承诺内送达', '96.4%', '≥ 97%', '复核', true],
    ['分拣占延误', '63%', '≤ 40%', '复核', true],
    ['干线准点', '98.1%', '≥ 98%', '保持', false],
    ['损耗率', '1.2%', '≤ 1.5%', '保持', false],
  ] as const
  const extra: DeckElement[] = [
    text('h-name', '指标', 64, 124, 240, 22, 13, { bold: true, color: '$muted' }),
    text('h-actual', '实际', 340, 124, 140, 22, 13, { bold: true, color: '$muted' }),
    text('h-target', '目标', 520, 124, 150, 22, 13, { bold: true, color: '$muted' }),
    text('h-act', '行动', 720, 124, 160, 22, 13, { bold: true, color: '$muted' }),
  ]
  rows.forEach((row, index) => {
    const y = 158 + index * 78
    if (row[4]) {
      extra.push(panel(`row-${index}`, 48, y, 864, 70, '$surface'))
      extra.push(panel(`bar-${index}`, 48, y, 6, 70, '$accent', 'decoration'))
    }
    extra.push(
      text(`name-${index}`, row[0], 68, y + 18, 250, 34, 20, { bold: true }),
      text(`actual-${index}`, row[1], 340, y + 12, 150, 46, 28, { bold: true, family: '$latin' }),
      text(`target-${index}`, row[2], 520, y + 18, 160, 34, 18, { family: '$latin' }),
      text(`act-${index}`, row[3], 720, y + 18, 160, 34, 18, { bold: row[4], color: row[4] ? '$accent' : '$ink' }),
    )
  })
  return makePage('07-scorecard', 'scorecard', '计分', '$paper', content('07  /  计分', '两条要复核，两条继续观察', `${SRC} · 目标为内部门槛`, '07', extra), '计分：送达和分拣要复核；干线和损耗先保持。')
}

function gantt(): ReturnType<typeof makePage> {
  const cols = ['W1–2', 'W3–4', 'W5–6', 'W7–8', 'W9–10', 'W11–12']
  const streams = [
    ['排班试验', '店长', 0, 2, false],
    ['分拣节拍', '仓配', 1, 3, true],
    ['损耗复盘', '财务', 2, 2, false],
    ['开店闸门', '总办', 5, 1, false],
  ] as const
  const extra: DeckElement[] = []
  cols.forEach((label, index) => {
    extra.push(text(`col-${index}`, label, 268 + index * 104, 124, 96, 22, 12, { color: '$muted', family: '$latin', align: 'center' }))
    extra.push(rule(`grid-${index}`, 268 + index * 104, 156, 1.5, 260, '$line', 1))
  })
  extra.push(rule('gate', 684, 156, 2, 260, '$accent', 1.75))
  streams.forEach((stream, index) => {
    const y = 168 + index * 72
    extra.push(
      text(`s-${index}`, stream[0], 48, y, 200, 26, 16, { bold: true }),
      text(`o-${index}`, stream[1], 48, y + 28, 200, 22, 13, { color: '$muted' }),
      panel(`bar-${index}`, 268 + stream[2] * 104, y + 4, stream[3] * 104 - 12, 32, stream[4] ? '$ink' : '$surface'),
    )
  })
  extra.push(text('gate-label', '第 8 周闸门', 698, 428, 180, 24, 13, { bold: true, color: '$accent' }))
  return makePage('08-gantt', 'gantt', '路线', '$paper', content('08  /  路线', '开店决定放在第 8 周闸门之后', `${SRC} · 闸门前需看到晚班超时下降`, '08', extra), '路线：排班和节拍在闸门前，开店决定在闸门后。')
}

function cases(): ReturnType<typeof makePage> {
  const columns = [
    { id: 'bin', x: 48, name: '滨江店', rows: [['超时', '6.2%'], ['损耗', '1.1%'], ['人效', '38 单']], verdict: '先改晚班排班' },
    { id: 'jiang', x: 492, name: '江北店', rows: [['超时', '2.4%'], ['损耗', '1.4%'], ['人效', '31 单']], verdict: '先维持现有人手' },
  ]
  const extra: DeckElement[] = []
  for (const column of columns) {
    extra.push(
      panel(`${column.id}-card`, column.x, 124, 420, 340, '$surface'),
      panel(`${column.id}-head`, column.x, 124, 420, 52, '$ink'),
      text(`${column.id}-name`, column.name, column.x + 20, 136, 380, 30, 22, { bold: true, color: '$inverse' }),
    )
    column.rows.forEach((row, index) => {
      const y = 196 + index * 58
      extra.push(
        text(`${column.id}-k-${index}`, row[0]!, column.x + 20, y, 160, 32, 16, { color: '$muted' }),
        text(`${column.id}-v-${index}`, row[1]!, column.x + 180, y - 6, 210, 40, 26, { bold: true, align: 'right' }),
      )
    })
    extra.push(text(`${column.id}-verdict`, column.verdict, column.x + 20, 392, 380, 40, 20, { bold: true }))
  }
  return makePage('09-case', 'case', '对照', '$paper', content('09  /  对照', '滨江改排班，江北先别加人', `${SRC} · 两店同季对比，不构成因果`, '09', extra), '对照：滨江超时更高，先改排班；江北先维持人手。')
}

function architecture(): ReturnType<typeof makePage> {
  const layers = [
    ['承诺', ['问诊', '下单', '预留']],
    ['履约', ['拣货', '出库', '配送']],
    ['回执', ['签收', '超时', '损耗']],
  ] as const
  const extra: DeckElement[] = [
    text('side', '横向是交接。\n纵向是依赖。\n配送前必须完成预留。', 700, 150, 210, 140, 16, { leading: 1.4 }),
  ]
  layers.forEach((layer, row) => {
    const y = 132 + row * 112
    extra.push(text(`layer-${row}`, layer[0], 48, y + 16, 88, 32, 16, { bold: true, color: '$muted' }))
    layer[1].forEach((name, col) => {
      const x = 150 + col * 176
      extra.push(
        panel(`node-${row}-${col}`, x, y, 156, 64, row === 1 ? '$ink' : '$surface'),
        text(`node-t-${row}-${col}`, name, x + 12, y + 16, 132, 32, 18, { bold: true, align: 'center', color: row === 1 ? '$inverse' : '$ink' }),
      )
      if (col < 2) extra.push(rule(`hx-${row}-${col}`, x + 156, y + 30, 20, 2, '$ink', 1.25))
    })
    if (row === 0) extra.push(rule('vx-reserve', 150 + 2 * 176 + 77, y + 64, 2, 48, '$ink', 1.25))
  })
  return makePage('10-architecture', 'architecture', '结构', '$paper', content('10  /  结构', '承诺之前，库存和运力先确认', `${SRC} · 结构示意，不是系统架构图`, '10', extra), '结构：预留完成之前，不向顾客承诺时段。')
}

function funnel(): ReturnType<typeof makePage> {
  const stages = [
    ['登记', 2400],
    ['下单', 1680],
    ['支付', 1510],
    ['出库', 1420],
    ['送达', 1369],
  ] as const
  const max = 2400
  const extra: DeckElement[] = []
  stages.forEach((stage, index) => {
    const h = Math.round(220 * stage[1] / max)
    const x = 48 + index * 112
    const y = 400 - h
    extra.push(
      text(`c-${index}`, String(stage[1]), x, 124, 100, 36, 20, { bold: true, align: 'center', family: '$latin' }),
      panel(`f-${index}`, x, y, 100, h, index === 4 ? '$accent' : '$ink'),
      text(`s-${index}`, stage[0], x, 412, 100, 28, 14, { align: 'center', color: '$muted' }),
    )
  })
  extra.push(
    text('end-k', '全流程', 640, 140, 260, 22, 13, { bold: true, color: '$muted' }),
    text('end', '57.0%', 640, 166, 260, 64, 48, { bold: true, family: '$latin' }),
    text('hop-k', '出库到送达', 640, 250, 260, 22, 13, { bold: true, color: '$accent' }),
    text('hop', '96.4%', 640, 276, 260, 64, 44, { bold: true, color: '$accent', family: '$latin' }),
    text('hop-n', '1369 / 1420。末段才是封面的数字。', 640, 348, 260, 64, 16, { leading: 1.35 }),
  )
  return makePage('11-funnel', 'funnel', '漏斗', '$paper', content('11  /  漏斗', '同一批订单，末段才是 96.4%', `${SRC} · 同一队列，1369/2400 = 57.0%`, '11', extra), '漏斗：封面 96.4% 是出库到送达，不是全流程。')
}

function closing(): ReturnType<typeof makePage> {
  return makePage('12-closing', 'closing', '收束', '$ink', [
    panel('mark', 48, 48, 56, 6, '$accent', 'decoration'),
    text('kicker', '12  /  下一步', 48, 68, 400, 24, 14, { bold: true, color: '$inverse' }),
    text('page-no', '12', 820, 68, 92, 24, 14, { bold: true, color: '$inverse', align: 'right', family: '$latin' }),
    text('title', '下一张表\n只回答一个问题', 48, 130, 820, 140, 48, { bold: true, color: '$inverse', leading: 1.08 }),
    text('question', '滨江店三个晚班，超时发生在哪一个小时？', 48, 300, 820, 40, 22, { color: '$surface' }),
    text('a', '01    连续两周计时，不增加人手', 48, 370, 760, 32, 18, { color: '$inverse' }),
    text('b', '02    超时下降后再打开第 8 周闸门', 48, 408, 760, 32, 18, { color: '$inverse' }),
    text('source', `${SRC} · 行动只保留这一项`, 48, 492, 740, 24, 12, { color: '$surface' }),
  ], '收束：只问滨江晚班的超时发生在哪一小时。')
}
