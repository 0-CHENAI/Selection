import { LAYOUTS, type Layout, type Spec } from './recipe';

const notes = '演示讲稿。页内数字是方案目标或模拟测算，不是实测结论，也不是访谈原话。';

/** Same Chinese heat-island story in every style, so visual differences come from composition. */
export function heatIslandSpec(style: Spec['style'], dataFolderPath: string): Spec {
  const source = '演示测算，非实测';
  return {
    version: 1,
    dataFolderPath,
    style,
    slides: [
      {
        layout: 'cover', title: '把城市热岛变成清凉街区', eyebrow: '城市更新 / 方案演示',
        subtitle: '用小规模试点验证遮阴、透水与社区协作', notes, source,
        slots: { presenter: 'Selection · 设计系统例', date: '2026 年 10 月' },
      },
      {
        layout: 'agenda', title: '先找热源，再做试点，最后评估', eyebrow: '路线', notes, source,
        slots: { items: ['识别步行路线上的高温暴露', '把有限预算投向连续遮阴', '用对照观测评估试点成效', '明确社区参与与维护责任'] },
      },
      {
        layout: 'section', title: '把诊断变成一条可走的路线', eyebrow: '章节', notes, source,
        slots: { number: '02', body: '试点不铺满整个街区，而是先连上学校与车站之间最热的一段路。' },
      },
      {
        layout: 'bullets', title: '现状里最热的不是整片街区', eyebrow: '诊断', notes, source,
        slots: { items: ['树荫彼此分离，午后路线仍然暴晒。', '空间有建设预算，维护责任不清晰。', '单看绿量，无法解释步行体验。'] },
      },
      {
        layout: 'comparison', title: '从点状绿化转向路线遮阴', eyebrow: '选择', notes, source,
        slots: {
          left: { heading: '现状：点状投入', body: '树池彼此分离，午后路线仍然暴晒。空间有建设预算，维护责任不清。单看绿量，无法解释步行体验。' },
          right: { heading: '试点：路线优先', body: '先连通学校与车站之间的遮阴。把养护责任写入街区协作清单。同时观察温度、使用与满意度。' },
        },
      },
      {
        layout: 'big-number', title: '把高温暴露时间降低三成', eyebrow: '目标', notes, source,
        slots: { value: '30%', label: '步行高温暴露时间降幅目标', context: '先做三个试点；以同一路线、同一时段的对照观测检验。演示目标，非实测结果。' },
      },
      {
        layout: 'process', title: '用四步把设计转成可维护的行动', eyebrow: '方法', notes, source,
        slots: {
          items: [
            { title: '识别热源', body: '固定路线与时段，记录暴晒和停留点。' },
            { title: '社区共创', body: '与居民核对需求，选定遮阴与休憩位置。' },
            { title: '轻量施工', body: '分段施工，保留通行并明确养护责任。' },
            { title: '对照复测', body: '重复观测，公开结果并决定是否扩展。' },
          ],
        },
      },
      {
        layout: 'chart', title: '遮阴组合的模拟降温幅度更大', eyebrow: '证据', notes, source,
        slots: {
          type: 'column', categories: ['现状', '单点绿化', '连续遮阴', '遮阴透水'],
          series: [{ name: '模拟温差', values: [0.4, 0.9, 1.6, 2.1] }],
          insight: '比较同一观测口径，避免把不同天气的温差直接相减。',
        },
      },
      {
        layout: 'quote', title: '让居民感受到路线变凉', eyebrow: '原则', notes, source,
        slots: { quote: '不是多种几棵树，而是让每一段路都更好走。', attribution: '本示例的设计原则，非访谈引文' },
      },
      {
        layout: 'timeline', title: '三个月形成可复用的试点证据', eyebrow: '节奏', notes, source,
        slots: {
          items: [
            { label: '第 1 月', title: '建立基线', body: '完成路线测绘与社区需求核对。' },
            { label: '第 2 月', title: '完成试点', body: '分段实施并公开养护责任。' },
            { label: '第 3 月', title: '评估复盘', body: '对照复测，形成扩展或调整建议。' },
          ],
        },
      },
      {
        layout: 'closing', title: '从一条清凉路线开始', eyebrow: '决定', notes, source,
        slots: { body: '批准试点范围，明确负责人，约定三个月后的评估节点。', contact: '下一步：确认路线 · 发布责任清单 · 开始基线观测' },
      },
    ],
  };
}

export function sweepSpec(style: Spec['style'], dataFolderPath: string): Spec {
  const slide = (layout: Layout, slots: Record<string, unknown>) => ({
    layout, title: `${layout} 标题示例`, notes: '布局覆盖。', eyebrow: '示例', slots,
  });
  const pair = { title: '标题', body: '一句说明。' };
  const byLayout: Record<Layout, Record<string, unknown>> = {
    cover: { presenter: '讲者', date: '2026' },
    agenda: { items: ['第一项', '第二项', '第三项'] },
    section: { number: '01', body: '章节说明。' },
    bullets: { items: ['要点一', '要点二', '要点三', '要点四'] },
    'image-text': { body: '图片旁的说明。', panel: { headline: '面板标题', body: '面板正文。' } },
    comparison: { left: { heading: '左侧', body: '左侧说明。' }, right: { heading: '右侧', body: '右侧说明。' } },
    'big-number': { value: '12', label: '示例标签', context: '示例语境。' },
    timeline: { items: [{ label: '一月', title: '开始', body: '说明。' }, { label: '二月', title: '推进', body: '说明。' }, { label: '三月', title: '复盘', body: '说明。' }] },
    process: { items: [pair, { title: '第二步', body: '说明。' }, { title: '第三步', body: '说明。' }] },
    chart: { type: 'column', categories: ['甲', '乙'], series: [{ name: '系列', values: [1, 2] }], insight: '读数说明。' },
    quote: { quote: '一句可核对的示例引文。', attribution: '示例出处' },
    closing: { body: '下一步说明。', contact: '联系人' },
    cards: { items: [pair, pair, pair] },
    matrix: { xLabel: '横轴', yLabel: '纵轴', cells: [pair, pair, pair, pair] },
  };
  return { version: 1, dataFolderPath, style, slides: LAYOUTS.map(layout => slide(layout, byLayout[layout])) };
}
