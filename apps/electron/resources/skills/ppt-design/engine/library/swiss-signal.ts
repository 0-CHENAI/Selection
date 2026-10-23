import { deckShell, Kit } from './kit';
import type { Deck, Page, Theme } from '../types';

export const swissSignalTheme: Theme = {
  id: 'swiss-signal',
  name: 'Swiss Signal',
  palette: {
    background: '#F5F3EE',
    surface: '#FFFFFF',
    text: '#111111',
    muted: '#4F4E49',
    accent: '#E52333',
    secondary: '#111111',
    rule: '#CBC8C0',
    inverse: '#FFFFFF',
    wash: '#E8E5DE',
  },
  fonts: {
    heading: {
      darwin: { latin: 'Helvetica Neue', cjk: 'PingFang SC' },
      win32: { latin: 'Arial', cjk: 'Microsoft YaHei' },
      linux: { latin: 'Noto Sans', cjk: 'Noto Sans CJK SC' },
    },
    body: {
      darwin: { latin: 'Helvetica Neue', cjk: 'PingFang SC' },
      win32: { latin: 'Arial', cjk: 'Microsoft YaHei' },
      linux: { latin: 'Noto Sans', cjk: 'Noto Sans CJK SC' },
    },
  },
  type: { hero: 42, title: 30, heading: 20, body: 18, label: 11, number: 56, footer: 11, caption: 13 },
  margin: 48,
};

const SOURCE = '示例数据，仅供版式对照，不构成经营结论。';

function swiss(index: number): Kit {
  return new Kit(swissSignalTheme, index, 12, SOURCE);
}

function furniture(k: Kit, eyebrow: string, title: string): void {
  k.rect(0, 0, 18, 540, 'text', { id: 'rail' });
  k.rect(18, 0, 942, 540, 'background', { id: 'field' });
  k.text(48, 22, 620, 16, eyebrow, 11, { role: 'label', color: 'muted', font: 'body', tracking: 1.2 });
  k.rect(48, 46, 52, 3, 'accent', { id: 'tick' });
  k.text(48, 58, 864, 64, title, 30, { role: 'title', weight: 700, lineHeight: 1.12 });
}

function footer(k: Kit): void {
  k.line(48, 500, 912, 500, 'rule', 0.6);
  k.text(48, 508, 760, 18, SOURCE, 11, { role: 'footer', color: 'muted', font: 'body' });
  k.text(820, 508, 92, 18, String(k.index + 1).padStart(2, '0'), 11, { role: 'footer', color: 'muted', align: 'right', font: 'body' });
}

function cover(): Page {
  const k = swiss(0);
  k.rect(0, 0, 18, 540, 'text', { id: 'rail' });
  k.rect(18, 0, 942, 540, 'background', { id: 'field' });
  k.text(48, 28, 520, 16, 'SWISS SIGNAL  /  经营复盘', 11, { role: 'label', color: 'muted', tracking: 1.4 });
  k.rect(48, 56, 56, 3, 'accent');
  k.text(48, 86, 500, 120, '从投放获客\n到门店经营', 42, { role: 'hero', weight: 700, lineHeight: 1.08 });
  k.text(48, 230, 500, 48, '华东零售网络如何把流量\n变成可复盘的店面利润。', 18, { role: 'body', color: 'muted' });
  k.text(48, 320, 500, 72, '受众：区域经营会\n决策：是否把投放预算改挂到门店单元\n范围：2024 示例账期', 16, { role: 'body', lineHeight: 1.35 });
  k.rect(620, 72, 300, 400, 'accent', { id: 'signal' });
  k.text(644, 140, 256, 88, '2.7×', 64, { role: 'number', color: 'inverse', weight: 700 });
  k.text(644, 248, 256, 72, '同店销售相对\n投放获客期', 20, { role: 'heading', color: 'inverse', weight: 600, lineHeight: 1.2 });
  k.text(644, 360, 256, 72, '分子：店面毛利\n分母：投放期获客成本', 14, { role: 'caption', color: 'inverse' });
  footer(k);
  return k.page('cover', 'cover', '封面：左侧主张，右侧只用一个红色信号数字。所有数字均为示例。');
}

function conclusion(): Page {
  const k = swiss(1);
  furniture(k, '01  /  结论', '先把门店做成可经营单元');
  k.text(48, 140, 340, 96, '投放可以买来访问，\n但不能替代店面的\n定价、库存和班次。', 22, { role: 'heading', weight: 700, lineHeight: 1.2 });
  k.text(48, 250, 340, 90, '下一阶段只扩大已经\n证明能独立核算的店。', 18, { role: 'body' });
  k.line(412, 140, 412, 480, 'rule');
  const rows: [string, string, string][] = [
    ['01', '67%', '复购贡献了\n示例营收主力'],
    ['02', '21.6%', '漏斗末端转化\n低于店面复购'],
    ['03', 'W6', '扩大投入前\n须过证据门槛'],
  ];
  rows.forEach(([n, v, body], i) => {
    const y = 140 + i * 114;
    k.text(448, y, 70, 28, n, 14, { role: 'label', color: 'text', weight: 700 });
    k.text(448, y + 28, 200, 44, v, 36, { role: 'number', weight: 700 });
    k.text(660, y + 28, 252, 56, body, 18, { role: 'body' });
    k.line(448, y + 100, 912, y + 100, 'rule', 0.5);
  });
  footer(k);
  return k.page('conclusion', 'conclusion', '结论页：一个主张加三条可核对证据。');
}

function tree(): Page {
  const k = swiss(2);
  furniture(k, '02  /  证据树', '把问题拆成可独立验证的分支');
  k.rect(48, 250, 200, 88, 'accent');
  k.text(60, 272, 176, 52, '核心假设\n店面可核算', 18, { role: 'heading', color: 'inverse', weight: 700, align: 'center' });
  k.line(248, 294, 300, 294, 'text', 1.2);
  const branches: [string, string, string][] = [
    ['需求', '复购是否稳定', '客单价有没有被折扣买来'],
    ['能力', '店长能否看懂周报', '库存是否按周盘清'],
    ['经济性', '毛利是否覆盖班次', '投放能否从店面利润出'],
  ];
  branches.forEach(([title, a, b], i) => {
    const y = 148 + i * 112;
    k.line(300, 294, 300, y + 28, 'text', 1);
    k.line(300, y + 28, 340, y + 28, 'text', 1);
    k.rect(340, y, 168, 56, 'surface', { stroke: 'rule', strokeWidth: 0.8 });
    k.text(352, y + 16, 144, 28, title, 18, { role: 'heading', weight: 700 });
    k.text(528, y - 4, 384, 28, a, 16, { role: 'body' });
    k.text(528, y + 28, 384, 28, b, 16, { role: 'body', color: 'muted' });
  });
  footer(k);
  return k.page('evidence-tree', 'evidence-tree', '证据树：每个分支都应能被单独证实或证伪。');
}

function matrix(): Page {
  const k = swiss(3);
  furniture(k, '03  /  2×2', '按准备度与回报选择下一步');
  k.rect(48, 150, 560, 320, 'wash');
  k.rect(328, 150, 280, 160, '#F4D4D6');
  k.line(328, 150, 328, 470, 'rule');
  k.line(48, 310, 608, 310, 'rule');
  k.text(60, 162, 240, 20, '继续观察', 12, { role: 'label', color: 'muted' });
  k.text(344, 162, 240, 20, '优先投入', 12, { role: 'label', color: 'text', weight: 700 });
  k.text(60, 438, 240, 20, '暂缓', 12, { role: 'label', color: 'muted' });
  k.text(344, 438, 240, 20, '择机试点', 12, { role: 'label', color: 'muted' });
  k.rect(430, 210, 18, 18, 'accent', { shape: 'ellipse' });
  k.text(454, 208, 80, 22, 'B', 16, { role: 'heading', weight: 700 });
  k.rect(150, 230, 12, 12, 'text', { shape: 'ellipse' });
  k.text(168, 226, 80, 22, 'A', 14, { role: 'body' });
  k.rect(210, 360, 12, 12, 'muted', { shape: 'ellipse' });
  k.text(228, 356, 80, 22, 'D', 14, { role: 'body' });
  k.rect(470, 360, 12, 12, 'muted', { shape: 'ellipse' });
  k.text(488, 356, 80, 22, 'E', 14, { role: 'body' });
  k.text(48, 476, 270, 16, '← 准备度更低', 12, { role: 'caption', color: 'muted' });
  k.text(338, 476, 270, 16, '准备度更高 →', 12, { role: 'caption', color: 'muted', align: 'right' });
  k.text(640, 150, 272, 56, '先验证 B', 28, { role: 'heading', weight: 700 });
  k.text(640, 220, 272, 72, '高回报且准备度足够，适合做范围明确的试点。', 18, { role: 'body' });
  const rows: [string, string][] = [['潜力', '影响较大'], ['证据', '信号更强'], ['投入', '先做六周试点']];
  rows.forEach(([a, b], i) => {
    const y = 320 + i * 48;
    k.line(640, y, 912, y, 'rule', 0.5);
    k.text(640, y + 10, 100, 24, a, 14, { role: 'label', color: 'muted' });
    k.text(748, y + 10, 164, 24, b, 16, { role: 'body', weight: 700 });
  });
  footer(k);
  return k.page('matrix', 'matrix', '2×2：主视觉是选择，不是四张等大卡片。');
}

function waterfall(): Page {
  const k = swiss(4);
  furniture(k, '04  /  瀑布', '把收益与成本放在同一条桥上');
  k.text(48, 140, 560, 18, 'A  /  经营利润桥  ·  指数点', 11, { role: 'label', color: 'muted' });
  k.chart(48, 168, 560, 300, {
    kind: 'waterfall',
    categories: ['基期', '规模', '服务', '启动', '结果'],
    series: [{ name: '变动', values: [100, 32, -13, -7, 112] }],
    showValues: true,
    hideBase: true,
  });
  k.line(640, 150, 640, 480, 'rule');
  k.text(664, 150, 248, 18, 'B  /  净影响', 11, { role: 'label', color: 'muted' });
  k.text(664, 178, 248, 72, '+12%', 56, { role: 'number', color: 'accent', weight: 700 });
  k.text(664, 260, 248, 40, '扣除成本后的净变化', 18, { role: 'body' });
  const rows: [string, string][] = [['规模收益', '+32'], ['服务与启动', '−20'], ['净变化', '+12']];
  rows.forEach(([a, b], i) => {
    const y = 330 + i * 44;
    k.line(664, y, 912, y, 'rule', 0.5);
    k.text(664, y + 8, 150, 24, a, 15, { role: 'body', weight: i === 2 ? 700 : 400 });
    k.text(824, y + 8, 88, 24, b, 20, { role: 'heading', align: 'right', weight: 700, color: 'text' });
  });
  footer(k);
  return k.page('waterfall', 'waterfall', '瀑布图：可见加减项必须能加总到净结果。');
}

function trend(): Page {
  const k = swiss(5);
  furniture(k, '05  /  趋势', '阅读趋势，追问停顿的原因');
  k.text(48, 140, 240, 18, 'A  /  周指数  ·  基期 = 100', 11, { role: 'label', color: 'muted' });
  k.rect(300, 168, 86, 280, '#F4D4D6');
  k.chart(48, 176, 560, 260, {
    kind: 'line',
    categories: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
    series: [{ name: '指数', values: [100, 108, 114, 112, 128, 142], color: 'text' }],
    showValues: true,
  });
  k.text(300, 148, 86, 18, 'W4 停顿', 11, { role: 'label', color: 'text', weight: 700, align: 'center' });
  k.line(640, 150, 640, 480, 'rule');
  k.text(664, 150, 248, 18, 'B  /  变化解读', 11, { role: 'label', color: 'muted' });
  k.text(664, 178, 248, 72, '+42%', 56, { role: 'number', color: 'accent', weight: 700 });
  k.text(664, 260, 248, 40, '相对基期的累计增长', 18, { role: 'body' });
  k.line(664, 320, 912, 320, 'rule');
  k.text(664, 336, 248, 18, '下一步检查', 12, { role: 'label', weight: 700 });
  k.text(664, 364, 248, 72, '第四周为何停顿，\n而不是只看期末点。', 18, { role: 'body' });
  footer(k);
  return k.page('trend-callouts', 'trend-callouts', '趋势图：标注异常周，而不是只画一条上升线。');
}

function scorecard(): Page {
  const k = swiss(6);
  furniture(k, '06  /  计分表', '把每项指标连接到后续行动');
  const heads: [number, string, number][] = [[48, '指标', 250], [320, '实际', 140], [480, '目标', 160], [668, '行动', 244]];
  heads.forEach(([x, label, w]) => k.text(x, 140, w, 20, label, 11, { role: 'label', color: 'muted' }));
  const rows: [string, string, string, string, boolean][] = [
    ['完成率', '73%', '> 70%', '保持观察', false],
    ['等待分钟', '7', '< 10', '保持观察', false],
    ['回访率', '58%', '> 65%', '复核缺口', true],
    ['单次任务成本', '¥8', '< ¥9', '保持观察', false],
  ];
  rows.forEach(([name, actual, goal, action, review], i) => {
    const y = 168 + i * 76;
    if (review) k.rect(48, y, 864, 70, '#F4D4D6');
    if (review) k.rect(48, y, 4, 70, 'accent');
    k.line(48, y, 912, y, 'rule', 0.5);
    k.text(60, y + 20, 240, 32, name, 18, { role: 'heading', weight: 700 });
    k.text(320, y + 16, 140, 40, actual, 28, { role: 'number', weight: 700 });
    k.text(480, y + 22, 160, 28, goal, 18, { role: 'body' });
    k.text(668, y + 22, 244, 28, review ? `↗  ${action}` : `—  ${action}`, 16, { role: 'body', weight: review ? 700 : 400 });
  });
  footer(k);
  return k.page('scorecard', 'scorecard', '计分表：例外行必须有负责动作，而不是只标红。');
}

function gantt(): Page {
  const k = swiss(7);
  furniture(k, '07  /  路线图', '围绕决策门槛安排执行顺序');
  k.text(48, 140, 240, 18, '工作流 / 负责人', 11, { role: 'label', color: 'muted' });
  ['W1–2', 'W3–4', 'W5–6', 'W7–8'].forEach((label, i) => k.text(320 + i * 148, 140, 140, 18, label, 12, { role: 'label', color: 'muted' }));
  for (let i = 0; i <= 4; i++) k.line(308 + i * 148, 168, 308 + i * 148, 470, 'wash', 0.6);
  const tasks: [string, string, number, number, boolean][] = [
    ['基线与范围', '研究团队', 0, 1.05, false],
    ['小规模试点', '门店运营', 0.8, 1.4, false],
    ['评估证据', '分析团队', 2.0, 1.15, true],
    ['决定下一步', '项目负责人', 3.05, 0.9, false],
  ];
  tasks.forEach(([title, owner, start, length, gate], i) => {
    const y = 180 + i * 70;
    k.line(48, y - 8, 912, y - 8, 'rule', 0.4);
    k.text(48, y, 240, 24, title, 18, { role: 'heading', weight: 700 });
    k.text(48, y + 28, 240, 18, owner, 12, { role: 'caption', color: 'muted' });
    k.rect(310 + start * 148, y + 8, length * 148, 28, gate ? 'accent' : 'text');
  });
  k.line(604, 168, 604, 470, 'accent', 1.4);
  k.text(560, 474, 120, 16, 'W6 门槛', 11, { role: 'label', color: 'text', align: 'center', weight: 700 });
  footer(k);
  return k.page('gantt', 'gantt', '甘特：时间条连接到一个明确的决策门槛。');
}

function architecture(): Page {
  const k = swiss(8);
  furniture(k, '08  /  架构', '围绕明确边界组织系统');
  const layers = ['计划', '执行', '学习'];
  const nodes = [
    ['需求预测', '运力计划', '线路设计'],
    ['订单接入', '调度', '配送'],
    ['服务数据', '问题复盘', '线路更新'],
  ];
  layers.forEach((layer, r) => {
    const y = 150 + r * 108;
    k.text(48, y + 28, 90, 28, layer, 14, { role: 'label', color: 'text', weight: 700 });
    nodes[r].forEach((name, c) => {
      const x = 160 + c * 176;
      k.rect(x, y, 156, 72, r === 1 ? 'accent' : 'surface', { stroke: r === 1 ? undefined : 'rule', strokeWidth: 0.8 });
      k.text(x + 10, y + 22, 136, 32, name, 16, { role: 'heading', weight: 700, color: r === 1 ? 'inverse' : 'text', align: 'center' });
      if (c < 2) k.line(x + 156, y + 36, x + 176, y + 36, 'text', 1.1);
    });
    if (r < 2) k.line(394, y + 72, 394, y + 108, 'text', 1.1);
  });
  k.line(700, 150, 700, 470, 'rule');
  k.text(720, 160, 192, 80, '每次交接\n都有负责人', 22, { role: 'heading', weight: 700, lineHeight: 1.2 });
  k.text(720, 270, 192, 96, '横向是交接，\n纵向是依赖。\n先衡量等待。', 16, { role: 'body' });
  footer(k);
  return k.page('architecture', 'architecture', '架构：三层边界，中间层是当前要盯住的交接。');
}

function compare(): Page {
  const k = swiss(9);
  furniture(k, '09  /  案例', '小范围改变，可衡量的结果');
  k.text(48, 148, 300, 18, '关键改变', 11, { role: 'label', color: 'muted' });
  k.text(48, 176, 300, 88, '一个清晰\n可见的下一步', 28, { role: 'heading', weight: 700, lineHeight: 1.15 });
  k.text(48, 290, 300, 72, '六周试点，任务定义不变，\n只改交接可见性。', 18, { role: 'body' });
  k.line(372, 150, 372, 480, 'rule');
  const metrics: [string, string, string, number, number][] = [
    ['等待 / 分钟', '18', '7', 18, 7],
    ['完成率 / %', '46%', '73%', 46, 73],
  ];
  metrics.forEach(([label, before, after, a, b], i) => {
    const y = 156 + i * 160;
    const max = Math.max(a, b);
    k.text(400, y, 512, 18, label, 11, { role: 'label', color: 'muted' });
    k.text(400, y + 24, 200, 44, before, 32, { role: 'number', weight: 700, color: 'muted' });
    k.text(640, y + 24, 272, 44, after, 32, { role: 'number', weight: 700, color: 'accent' });
    k.rect(400, y + 78, Math.max(16, (a / max) * 200), 14, 'muted');
    k.rect(640, y + 78, Math.max(16, (b / max) * 200), 14, 'accent');
    k.text(400, y + 100, 200, 18, '试点前', 12, { role: 'caption', color: 'muted' });
    k.text(640, y + 100, 200, 18, '试点后', 12, { role: 'caption', color: 'text' });
  });
  footer(k);
  return k.page('case-compare', 'case-compare', '案例对比：前后口径必须相同，不作因果夸大。');
}

function funnel(): Page {
  const k = swiss(10);
  furniture(k, '10  /  漏斗', '沿漏斗追踪同一群体');
  k.text(48, 140, 620, 18, '同一初始群体 1,000 人', 11, { role: 'label', color: 'muted' });
  const steps: [string, number, boolean][] = [
    ['触达', 1000, false],
    ['进店', 640, false],
    ['成交', 360, true],
    ['复购', 216, false],
  ];
  steps.forEach(([name, count, hot], i) => {
    const x = 48 + i * 168;
    const y = 170 + i * 36;
    k.rect(x, y, 148, 260 - i * 36, hot ? 'accent' : 'surface', { stroke: hot ? undefined : 'rule', strokeWidth: 0.8 });
    k.text(x + 12, y + 16, 124, 40, String(count), 28, { role: 'number', weight: 700, color: hot ? 'inverse' : 'text' });
    k.text(x + 12, 390, 124, 28, name, 16, { role: 'heading', weight: 700, color: hot ? 'inverse' : 'text' });
    if (i < 3) {
      const nextY = 170 + (i + 1) * 36;
      k.line(x + 148, nextY + 8, x + 168, nextY + 8, 'text', 1.1);
    }
  });
  k.line(740, 160, 740, 460, 'rule');
  k.text(760, 176, 152, 56, '21.6%', 36, { role: 'number', color: 'accent', weight: 700 });
  k.text(760, 250, 152, 72, '全流程转化\n216 / 1,000', 18, { role: 'body' });
  footer(k);
  return k.page('funnel', 'funnel', '漏斗：阶梯高度只示意规模，数字以标注为准。');
}

function closing(): Page {
  const k = swiss(11);
  k.rect(0, 0, 960, 540, 'text', { id: 'field' });
  k.rect(0, 0, 18, 540, 'accent', { id: 'rail' });
  k.text(48, 28, 600, 16, '11  /  下一步', 11, { role: 'label', color: 'wash' });
  k.text(48, 70, 800, 80, '一个明确问题。\n一项具体行动。', 36, { role: 'hero', color: 'inverse', weight: 700, lineHeight: 1.12 });
  const items = ['冻结投放加码，直到 B 店完成六周试点。', '店长周报只保留完成率、等待和复购三列。', 'W6 门槛：复购不低于 65%，否则回退。'];
  items.forEach((item, i) => {
    const y = 200 + i * 80;
    k.text(48, y, 70, 36, `0${i + 1}`, 28, { role: 'number', color: 'accent', weight: 700 });
    k.text(130, y + 6, 740, 40, item, 20, { role: 'heading', color: 'inverse' });
    k.line(130, y + 56, 870, y + 56, 'rule', 0.4);
  });
  k.text(48, 508, 760, 18, SOURCE, 11, { role: 'footer', color: 'wash' });
  k.text(820, 508, 92, 18, '12', 11, { role: 'footer', color: 'wash', align: 'right' });
  return k.page('closing', 'closing', '收束：黑场只放行动，不再重复分析。');
}

export function buildSwissSignalDeck(): Deck {
  const pages = [cover, conclusion, tree, matrix, waterfall, trend, scorecard, gantt, architecture, compare, funnel, closing].map(fn => fn());
  return deckShell(swissSignalTheme, pages, 'Swiss Signal 参考页');
}
