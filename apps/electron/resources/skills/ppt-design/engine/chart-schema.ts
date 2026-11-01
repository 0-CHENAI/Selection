/**
 * PptxGenJS 写出的图表 XML 有几处不符合 OOXML 架构（PowerPoint 能打开，但严格校验会报错）：
 * - 二维柱图、折线图写了第三个 c:axId（只有三维图才有）；
 * - 折线图缺 c:grouping，系列里多了柱图才有的 c:invertIfNegative；
 * - 我们给单个数据点上色时，c:dPt 落在 c:dLbls 后面，顺序反了。
 * 这里按架构里的子元素顺序重排每个图表类型和系列，丢掉架构不允许的子元素，补上必需的 grouping。
 */

const SERIES: Record<string, string[]> = {
  barChart: ['idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'pictureOptions', 'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'shape', 'extLst'],
  bar3DChart: ['idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'pictureOptions', 'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'shape', 'extLst'],
  lineChart: ['idx', 'order', 'tx', 'spPr', 'marker', 'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'smooth', 'extLst'],
  areaChart: ['idx', 'order', 'tx', 'spPr', 'pictureOptions', 'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'extLst'],
  pieChart: ['idx', 'order', 'tx', 'spPr', 'explosion', 'dPt', 'dLbls', 'cat', 'val', 'extLst'],
  doughnutChart: ['idx', 'order', 'tx', 'spPr', 'explosion', 'dPt', 'dLbls', 'cat', 'val', 'extLst'],
  scatterChart: ['idx', 'order', 'tx', 'spPr', 'marker', 'dPt', 'dLbls', 'trendline', 'errBars', 'xVal', 'yVal', 'smooth', 'extLst'],
  radarChart: ['idx', 'order', 'tx', 'spPr', 'marker', 'dPt', 'dLbls', 'cat', 'val', 'extLst'],
  bubbleChart: ['idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'dPt', 'dLbls', 'trendline', 'errBars', 'xVal', 'yVal', 'bubbleSize', 'bubble3D', 'extLst'],
}

const CHART: Record<string, { order: string[]; axes: number }> = {
  barChart: { order: ['barDir', 'grouping', 'varyColors', 'ser', 'dLbls', 'gapWidth', 'overlap', 'serLines', 'axId', 'extLst'], axes: 2 },
  bar3DChart: { order: ['barDir', 'grouping', 'varyColors', 'ser', 'dLbls', 'gapWidth', 'gapDepth', 'shape', 'axId', 'extLst'], axes: 3 },
  lineChart: { order: ['grouping', 'varyColors', 'ser', 'dLbls', 'dropLines', 'hiLowLines', 'upDownBars', 'marker', 'smooth', 'axId', 'extLst'], axes: 2 },
  areaChart: { order: ['grouping', 'varyColors', 'ser', 'dLbls', 'dropLines', 'axId', 'extLst'], axes: 2 },
  pieChart: { order: ['varyColors', 'ser', 'dLbls', 'firstSliceAng', 'extLst'], axes: 0 },
  doughnutChart: { order: ['varyColors', 'ser', 'dLbls', 'firstSliceAng', 'holeSize', 'extLst'], axes: 0 },
  scatterChart: { order: ['scatterStyle', 'varyColors', 'ser', 'dLbls', 'axId', 'extLst'], axes: 2 },
  radarChart: { order: ['radarStyle', 'varyColors', 'ser', 'dLbls', 'axId', 'extLst'], axes: 2 },
  bubbleChart: { order: ['varyColors', 'ser', 'dLbls', 'bubble3D', 'bubbleScale', 'showNegBubbles', 'sizeRepresents', 'axId', 'extLst'], axes: 2 },
}

type Child = { name: string; xml: string }

/** 拆出一段 XML 的直接子元素（含前后空白之外的全部标记）。 */
function children(inner: string): Child[] | null {
  const out: Child[] = []
  const tag = /<(\/?)([\w:.-]+)[^>]*?(\/?)>/g
  let depth = 0
  let start = -1
  let name = ''
  let match: RegExpExecArray | null
  while ((match = tag.exec(inner))) {
    if (match[0].startsWith('<?') || match[0].startsWith('<!')) continue
    const closing = match[1] === '/'
    const selfClosing = match[3] === '/'
    if (!closing && depth === 0) {
      start = match.index
      name = match[2]!
    }
    if (closing) depth -= 1
    else if (!selfClosing) depth += 1
    if (depth < 0) return null
    if (depth === 0 && start >= 0) {
      out.push({ name: name.replace(/^c:/, ''), xml: inner.slice(start, tag.lastIndex) })
      start = -1
    }
  }
  return depth === 0 ? out : null
}

const KNOWN = new Set([...Object.values(SERIES).flat(), ...Object.values(CHART).flatMap(spec => spec.order), 'ser'])

/** 按架构顺序排；本类型不允许的已知元素丢掉，不认识的（其他命名空间）原样放在最后。 */
function reorder(items: Child[], order: string[], limits: Record<string, number> = {}): Child[] {
  const sorted: Child[] = []
  for (const key of order) {
    const matches = items.filter(item => item.name === key)
    sorted.push(...(limits[key] !== undefined ? matches.slice(0, limits[key]) : matches))
  }
  sorted.push(...items.filter(item => !KNOWN.has(item.name)))
  return sorted
}

function rewriteElement(xml: string, local: string, rewrite: (inner: string) => string | null): string {
  const pattern = new RegExp(`(<c:${local}>)([\\s\\S]*?)(</c:${local}>)`, 'g')
  return xml.replace(pattern, (all, open: string, inner: string, close: string) => {
    const next = rewrite(inner)
    return next === null ? all : `${open}${next}${close}`
  })
}

export function normalizeChartXml(xml: string): string {
  let next = xml
  for (const [kind, spec] of Object.entries(CHART)) {
    if (!next.includes(`<c:${kind}>`)) continue
    next = rewriteElement(next, kind, inner => {
      const items = children(inner)
      if (!items) return null
      const series = SERIES[kind]!
      const fixed = items.map(item => {
        if (item.name !== 'ser') return item
        const body = item.xml.slice('<c:ser>'.length, -'</c:ser>'.length)
        const parts = children(body)
        if (!parts) return item
        return { name: 'ser', xml: `<c:ser>${reorder(parts, series).map(part => part.xml).join('')}</c:ser>` }
      })
      if ((kind === 'lineChart' || kind === 'areaChart') && !fixed.some(item => item.name === 'grouping')) {
        fixed.unshift({ name: 'grouping', xml: '<c:grouping val="standard"/>' })
      }
      return reorder(fixed, spec.order, { axId: spec.axes }).map(item => item.xml).join('')
    })
  }
  return next
}
