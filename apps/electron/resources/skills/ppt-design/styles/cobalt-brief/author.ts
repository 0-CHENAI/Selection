import { chart, chrome, makeDeck, makePage, panel, rule, text } from '../kit.ts'
import type { Deck, DeckElement, Theme } from '../../engine/types.ts'

export const cobaltTheme: Theme = {
  id: 'cobalt-brief',
  name: 'Cobalt Brief',
  margin: 48,
  colors: {
    ink: '#111111',
    paper: '#FDFAE7',
    muted: '#5A5A5A',
    accent: '#1E2BFA',
    line: '#E2DECF',
    surface: '#EEEEFB',
    inverse: '#FFFFFF',
    night: '#161616',
    mist: '#D7D9FF',
  },
  fonts: {
    cjk: { mac: 'PingFang SC', win: 'Microsoft YaHei', linux: 'Noto Sans CJK SC' },
    latin: { mac: 'Arial', win: 'Arial', linux: 'Noto Sans' },
  },
  type: {
    display: { min: 44, max: 80 },
    title: { min: 28, max: 36 },
    body: { min: 16, max: 22 },
    caption: { min: 11, max: 14 },
  },
  source: 'Palette and hierarchy adapted from Zara Zhang beautiful-html-templates blue-professional (MIT, e5e204fb): cream #FDFAE7, cobalt #1E2BFA, ink #111111. Space Grotesk and Inter are the reference faces; runtime uses the system pairs below and does not embed font files. Page geometry is original.',
}

const SRC = '示例 · 非真实运行记录'

function content(kicker: string, title: string, source: string, pageNo: string, extra: DeckElement[], dark = false): DeckElement[] {
  return [...chrome({
    kicker,
    title,
    source,
    pageNo,
    ink: dark ? '$inverse' : '$ink',
    muted: dark ? '$mist' : '$muted',
    accent: dark ? '$mist' : '$accent',
    line: dark ? '$mist' : '$line',
  }), ...extra]
}

export function buildCobaltDeck(): Deck {
  return makeDeck('澄湾检验 · 晨检网络', cobaltTheme, [
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
    panel('bar', 0, 0, 960, 8, '$accent', 'decoration'),
    text('kicker', 'COBALT BRIEF', 48, 32, 360, 20, 13, { bold: true, color: '$accent', family: '$latin', tracking: 1.4 }),
    text('meta', '澄湾检验 · 2025', 560, 32, 352, 20, 14, { align: 'right', color: '$muted' }),
    text('title', '先改周一早高峰\n再谈第二台设备', 48, 88, 560, 140, 44, { bold: true, leading: 1.08 }),
    text('deck', '早高峰接收能省下的时间，多于再买一台流水线。', 48, 248, 540, 36, 18),
    panel('slab', 660, 88, 252, 300, '$accent'),
    text('slab-k', '中位周转', 680, 112, 212, 24, 14, { bold: true, color: '$inverse' }),
    text('slab-n', '4.6', 680, 150, 212, 96, 72, { bold: true, color: '$inverse', family: '$latin' }),
    text('slab-u', '小时 · 目标 4.0', 680, 258, 212, 28, 16, { color: '$inverse' }),
    text('slab-d', '2025 全年示例', 680, 320, 212, 28, 14, { color: '$inverse' }),
    rule('fact-rule', 48, 412, 864, 1, '$ink', 1.25),
    text('f1-n', '93.1%', 48, 428, 250, 40, 28, { bold: true, family: '$latin' }),
    text('f1-l', '审核后准时发布', 48, 472, 250, 24, 14, { color: '$muted' }),
    text('f2-n', '38%', 336, 428, 250, 40, 28, { bold: true, family: '$latin', color: '$accent' }),
    text('f2-l', '标本挤在周一早高峰', 336, 472, 250, 24, 14, { color: '$muted' }),
    text('f3-n', '0.3h', 624, 428, 250, 40, 28, { bold: true, family: '$latin' }),
    text('f3-l', '第二台设备只能再省', 624, 472, 250, 24, 14, { color: '$muted' }),
  ], '封面：先改早高峰接收，设备决定往后放。示例数据。')
}

function conclusion(): ReturnType<typeof makePage> {
  const cols = [
    ['01', '38%', '周一 7:30–9:00', '接收了全天标本的 38%。'],
    ['02', '0.7h', '改接收窗口', '早高峰计时能省下约 0.7 小时。'],
    ['03', '0.3h', '再买一台', '流水线只能再省 0.3 小时。'],
  ]
  const extra: DeckElement[] = [
    text('lead', '设备不是这一季的杠杆。先把东院周一早晨的接收从人工队列里拿出来。', 48, 122, 864, 56, 18, { leading: 1.35 }),
  ]
  cols.forEach((col, index) => {
    const x = 48 + index * 296
    extra.push(
      rule(`rule-${index}`, x, 196, 270, 1, '$accent', 1.5),
      text(`n-${index}`, col[1]!, x, 214, 270, 64, 40, { bold: true, family: '$latin', color: index === 0 ? '$accent' : '$ink' }),
      text(`h-${index}`, col[2]!, x, 286, 270, 32, 18, { bold: true }),
      text(`d-${index}`, col[3]!, x, 324, 270, 64, 16, { color: '$muted', leading: 1.35 }),
    )
  })
  return makePage('02-conclusion', 'conclusion', '结论', '$paper', content('02  /  结论', '先改周一早高峰，再买设备', `${SRC} · 0.7 与 0.3 为内部测算`, '02', extra), '结论：早高峰接收的杠杆大于第二台设备。')
}

function trend(): ReturnType<typeof makePage> {
  return makePage('03-trend', 'trend', '趋势', '$paper', content('03  /  趋势', '7 月回升，不是设备掉速', `${SRC} · 月度中位周转，小时`, '03', [
    panel('note', 48, 124, 250, 340, '$surface'),
    text('note-k', '两次回升', 68, 144, 210, 22, 13, { bold: true, color: '$accent' }),
    text('note-a', '4 月', 68, 180, 210, 36, 22, { bold: true }),
    text('note-a2', '试剂切换后的一周', 68, 218, 210, 28, 14, { color: '$muted' }),
    text('note-b', '7 月', 68, 262, 210, 36, 22, { bold: true }),
    text('note-b2', '住院高峰，不是仪器停机', 68, 300, 210, 48, 14, { color: '$muted', leading: 1.35 }),
    text('note-c', '年末 4.5 小时。方向向下，7 月仍要单独解释。', 68, 368, 210, 72, 16, { leading: 1.35 }),
    chart('year', 322, 124, 590, 340, {
      kind: 'line',
      categories: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      series: [{ name: '小时', values: [6.1, 5.8, 5.6, 5.9, 5.2, 4.9, 5.4, 4.8, 4.7, 4.6, 4.6, 4.5] }],
      colors: ['$accent'],
    }),
  ]), '趋势：全年下降，4 月和 7 月是两次需要解释的回升。')
}

function tree(): ReturnType<typeof makePage> {
  const cols = [
    ['采集', '合格率 95%', '11400 / 12000，不是主因'],
    ['接收', '周一多等 26 分钟', '早高峰队列是当前杠杆'],
    ['审核', '双人复核 8 分钟', '占比小，先不要加岗'],
  ]
  const extra: DeckElement[] = [
    panel('root', 48, 124, 864, 72, '$accent'),
    text('root-t', '先看接收排队，不把时间花在已经合格的采集上', 68, 144, 824, 36, 20, { bold: true, color: '$inverse' }),
  ]
  cols.forEach((col, index) => {
    const x = 48 + index * 296
    extra.push(
      text(`k-${index}`, col[0]!, x, 220, 270, 24, 13, { bold: true, color: '$accent' }),
      text(`h-${index}`, col[1]!, x, 250, 270, 72, 26, { bold: true, leading: 1.2 }),
      text(`d-${index}`, col[2]!, x, 332, 270, 64, 16, { color: '$muted', leading: 1.35 }),
    )
  })
  extra.push(
    rule('so-rule', 48, 424, 864, 1, '$ink', 1.25),
    text('so', '这一季先改接收窗口。上机和审核岗先不动。', 48, 440, 864, 32, 18, { bold: true }),
  )
  return makePage('04-evidence-tree', 'evidence-tree', '证据', '$paper', content('04  /  证据', '周转变长，先看接收不先看上机', `${SRC} · 合格率、等待和复核分开计`, '04', extra), '证据：采集合格率已经 95%，等待发生在接收。')
}

function matrix(): ReturnType<typeof makePage> {
  const cells = [
    ['急诊通道', '高影响 · 低可控', '依赖临床，本次不改流程', false],
    ['早高峰接收', '高影响 · 高可控', '东院窗口两周内能改', true],
    ['外包夜班', '低影响 · 低可控', '先保持观察', false],
    ['试剂批号', '低影响 · 高可控', '放进常规更换', false],
  ] as const
  const extra: DeckElement[] = []
  cells.forEach((cell, index) => {
    const x = 48 + (index % 2) * 444
    const y = 124 + Math.floor(index / 2) * 172
    extra.push(
      panel(`c-${index}`, x, y, 420, 156, cell[3] ? '$accent' : '$surface'),
      text(`k-${index}`, cell[1], x + 20, y + 18, 380, 24, 13, { bold: true, color: cell[3] ? '$inverse' : '$accent' }),
      text(`h-${index}`, cell[0], x + 20, y + 50, 380, 40, 24, { bold: true, color: cell[3] ? '$inverse' : '$ink' }),
      text(`d-${index}`, cell[2], x + 20, y + 100, 380, 32, 16, { color: cell[3] ? '$inverse' : '$muted' }),
    )
  })
  return makePage('05-matrix', 'matrix', '矩阵', '$paper', content('05  /  取舍', '先动早高峰，门诊批量先排队', `${SRC} · 影响与可控为科室判断`, '05', extra), '矩阵：先改早高峰接收。急诊通道依赖临床，本次不动。')
}

function waterfall(): ReturnType<typeof makePage> {
  const bits = [
    ['流程', '−0.8'],
    ['设备', '−0.4'],
    ['外包', '+0.3'],
    ['标本', '−0.6'],
    ['净变化', '−1.5'],
  ]
  const extra: DeckElement[] = [
    chart('bridge', 48, 122, 864, 230, {
      kind: 'waterfall',
      categories: ['起点', '流程', '设备', '外包', '标本', '期末'],
      series: [{ name: '小时', values: [6.1, -0.8, -0.4, 0.3, -0.6, 4.6] }],
    }),
  ]
  bits.forEach((bit, index) => {
    const x = 48 + index * 176
    extra.push(
      text(`k-${index}`, bit[0]!, x, 366, 160, 22, 13, { color: index === 4 ? '$accent' : '$muted', bold: true }),
      text(`v-${index}`, bit[1]!, x, 390, 160, 40, 26, { bold: true, family: '$latin', color: index === 4 ? '$accent' : '$ink' }),
    )
  })
  return makePage('06-waterfall', 'waterfall', '瀑布', '$paper', content('06  /  瀑布', '周转从 6.1 小时收到 4.6', `${SRC} · 6.1 −0.8 −0.4 +0.3 −0.6 = 4.6`, '06', extra), '瀑布轧平：净减少 1.5 小时，外包是唯一回升项。')
}

function scorecard(): ReturnType<typeof makePage> {
  const cards = [
    ['中位周转', '4.6h', '目标 ≤ 4.0', '复核', true],
    ['准时发布', '93.1%', '目标 ≥ 95%', '复核', true],
    ['复检率', '2.8%', '目标 ≤ 3.0%', '保持', false],
    ['仪器空转', '11%', '目标 ≤ 15%', '保持', false],
  ] as const
  const extra: DeckElement[] = []
  cards.forEach((card, index) => {
    const x = 48 + (index % 2) * 444
    const y = 124 + Math.floor(index / 2) * 172
    extra.push(
      panel(`card-${index}`, x, y, 420, 156, '$surface'),
      panel(`tick-${index}`, x, y, 8, 156, card[4] ? '$accent' : '$line', 'decoration'),
      text(`k-${index}`, card[0], x + 28, y + 16, 250, 24, 14, { color: '$muted' }),
      text(`act-${index}`, card[3], x + 280, y + 16, 116, 24, 14, { align: 'right', bold: true, color: card[4] ? '$accent' : '$ink' }),
      text(`v-${index}`, card[1], x + 28, y + 48, 360, 56, 36, { bold: true, family: '$latin' }),
      text(`t-${index}`, card[2], x + 28, y + 112, 360, 24, 14, { color: '$muted' }),
    )
  })
  return makePage('07-scorecard', 'scorecard', '计分', '$paper', content('07  /  计分', '周转和准时发布还没过线', `${SRC} · 门槛为科室年度目标`, '07', extra), '计分：周转和准时发布复核；复检率和空转保持。')
}

function gantt(): ReturnType<typeof makePage> {
  const heads = ['W1–2', 'W3–4', 'W5–6', 'W7–8', 'W9–10', 'W11–12']
  const rows = [
    ['早高峰试验', '检验科', 0, 2],
    ['上机排序', '值班长', 1, 2],
    ['审核双人', '质量组', 2, 2],
    ['设备闸门', '总办', 4, 2],
  ] as const
  const extra: DeckElement[] = []
  heads.forEach((head, index) => {
    extra.push(text(`h-${index}`, head, 250 + index * 110, 122, 100, 22, 12, { color: '$muted', family: '$latin' }))
    extra.push(rule(`grid-${index}`, 250 + index * 110, 150, 1, 280, '$line', 1))
  })
  extra.push(rule('gate', 690, 150, 2, 280, '$accent', 1.75))
  rows.forEach((row, index) => {
    const y = 162 + index * 72
    extra.push(
      text(`n-${index}`, row[0], 48, y, 180, 26, 16, { bold: true }),
      text(`o-${index}`, row[1], 48, y + 28, 180, 22, 13, { color: '$muted' }),
      panel(`bar-${index}`, 250 + row[2] * 110, y + 6, row[3] * 110 - 14, 30, index === 3 ? '$accent' : '$ink'),
    )
  })
  extra.push(text('gate-l', '第 8 周前不采购', 704, 438, 200, 24, 14, { bold: true, color: '$accent' }))
  return makePage('08-gantt', 'gantt', '路线', '$paper', content('08  /  路线', '设备决定放在第八周闸门后', `${SRC} · 闸门前要看到东院早高峰下降`, '08', extra), '路线：试验、排序、审核在闸门前，采购在闸门后。')
}

function cases(): ReturnType<typeof makePage> {
  const rows = [
    ['中位周转', '5.4 小时', '3.9 小时'],
    ['准时发布', '90%', '96%'],
    ['早高峰占比', '44%', '27%'],
  ]
  const extra: DeckElement[] = [
    text('east', '东院', 360, 122, 220, 32, 18, { bold: true, color: '$accent' }),
    text('west', '西院', 620, 122, 220, 32, 18, { bold: true }),
  ]
  rows.forEach((row, index) => {
    const y = 170 + index * 78
    extra.push(
      rule(`line-${index}`, 48, y, 864, 1),
      text(`k-${index}`, row[0]!, 48, y + 16, 280, 36, 18, { bold: true }),
      text(`e-${index}`, row[1]!, 360, y + 10, 220, 44, 26, { bold: true, color: '$accent' }),
      text(`w-${index}`, row[2]!, 620, y + 10, 220, 44, 26, { bold: true }),
    )
  })
  extra.push(text('verdict', '先改东院接收窗口。西院班次这次不动。', 48, 410, 864, 40, 20, { bold: true }))
  return makePage('09-case', 'case', '对照', '$paper', content('09  /  对照', '东院改接收，西院先维持班次', `${SRC} · 同季对照，不构成因果`, '09', extra), '对照：东院更慢且早高峰更挤，先改东院。')
}

function architecture(): ReturnType<typeof makePage> {
  const layers = [
    ['01  接收', '采集    运送    核收'],
    ['02  检验', '上机    检测    审核'],
    ['03  发布', '报告    危急值    复检'],
  ]
  const extra: DeckElement[] = []
  layers.forEach((layer, index) => {
    const y = 124 + index * 112
    extra.push(
      panel(`band-${index}`, 48, y, 640, 96, index === 0 ? '$accent' : '$surface'),
      text(`t-${index}`, layer[0]!, 72, y + 16, 592, 28, 16, { bold: true, color: index === 0 ? '$inverse' : '$accent' }),
      text(`d-${index}`, layer[1]!, 72, y + 48, 592, 32, 22, { bold: true, color: index === 0 ? '$inverse' : '$ink' }),
    )
  })
  extra.push(
    text('side-k', '主人', 716, 124, 196, 24, 13, { bold: true, color: '$accent' }),
    text('side', '每一段都写上值班主人。没有主人的交接，不算完成。', 716, 156, 196, 140, 16, { leading: 1.4 }),
  )
  return makePage('10-architecture', 'architecture', '结构', '$paper', content('10  /  结构', '发布之前，每段都要有主人', `${SRC} · 职责示意，不是系统图`, '10', extra), '结构：接收、检验、发布三段，每段有值班主人。')
}

function funnel(): ReturnType<typeof makePage> {
  const rows = [
    ['登记', '12000', 864],
    ['合格核收', '11400', 760],
    ['上机', '11000', 680],
    ['审核完成', '10600', 600],
    ['准时发布', '9870', 520],
  ] as const
  const extra: DeckElement[] = []
  rows.forEach((row, index) => {
    const y = 124 + index * 58
    extra.push(
      panel(`bar-${index}`, 48, y, row[2], 46, index === 4 ? '$accent' : '$ink'),
      text(`name-${index}`, row[0]!, 64, y + 10, 220, 28, 16, { bold: true, color: '$inverse' }),
      text(`num-${index}`, row[1]!, 48 + row[2] - 160, y + 6, 140, 34, 20, { bold: true, color: '$inverse', align: 'right', family: '$latin' }),
    )
  })
  extra.push(text('rate', '全流程 82.3%    审核后准时 93.1%', 48, 424, 864, 32, 18, { bold: true }))
  return makePage('11-funnel', 'funnel', '漏斗', '$paper', content('11  /  漏斗', '同一批标本，全流程是 82.3%', `${SRC} · 9870/12000 = 82.3%，9870/10600 = 93.1%`, '11', extra), '漏斗：82.3% 是全流程，93.1% 是审核后的准时发布。')
}

function closing(): ReturnType<typeof makePage> {
  return makePage('12-closing', 'closing', '收束', '$night', [
    panel('bar', 0, 0, 960, 8, '$accent', 'decoration'),
    text('kicker', '12  /  下一步', 48, 36, 400, 24, 14, { bold: true, color: '$mist' }),
    text('page-no', '12', 820, 36, 92, 24, 14, { bold: true, color: '$inverse', align: 'right', family: '$latin' }),
    text('q-k', '一个问题', 48, 120, 520, 24, 14, { bold: true, color: '$mist' }),
    text('q', '周一 7:30 的标本，\n还在人工分拣吗？', 48, 156, 520, 140, 36, { bold: true, color: '$inverse', leading: 1.15 }),
    panel('action', 620, 150, 292, 250, '$accent'),
    text('a-k', '一项行动', 644, 174, 244, 24, 14, { bold: true, color: '$inverse' }),
    text('a', '连续两周给东院早高峰计时。第 8 周再决定设备。', 644, 214, 244, 140, 20, { color: '$inverse', leading: 1.35 }),
    text('source', `${SRC} · 只保留这一项行动`, 48, 492, 740, 24, 12, { color: '$mist' }),
  ], '收束：先给东院早高峰计时两周，第 8 周再谈设备。')
}
