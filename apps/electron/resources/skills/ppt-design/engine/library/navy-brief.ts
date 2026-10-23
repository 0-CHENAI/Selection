import { deckShell, Kit } from './kit';
import type { Deck, Page, Theme } from '../types';

export const navyBriefTheme: Theme = {
  id: 'navy-brief',
  name: 'Navy Brief',
  palette: {
    background: '#0B1220',
    surface: '#172033',
    text: '#F3EEE4',
    muted: '#A89F90',
    accent: '#C9A36A',
    secondary: '#8FA3C4',
    rule: '#2A3548',
    inverse: '#0B1220',
    wash: '#121A2A',
  },
  fonts: {
    heading: {
      darwin: { latin: 'Helvetica Neue', cjk: 'PingFang SC' },
      win32: { latin: 'Segoe UI', cjk: 'Microsoft YaHei' },
      linux: { latin: 'Noto Sans', cjk: 'Noto Sans CJK SC' },
    },
    body: {
      darwin: { latin: 'Helvetica Neue', cjk: 'PingFang SC' },
      win32: { latin: 'Segoe UI', cjk: 'Microsoft YaHei' },
      linux: { latin: 'Noto Sans', cjk: 'Noto Sans CJK SC' },
    },
  },
  type: { hero: 44, title: 32, heading: 20, body: 18, label: 12, number: 54, footer: 11, caption: 13 },
  margin: 48,
};

const SOURCE = '决策简报示例。数字、门槛和责任人均为虚构。';

function navy(index: number): Kit {
  return new Kit(navyBriefTheme, index, 12, SOURCE);
}

function header(k: Kit, kicker: string, title: string): void {
  k.rect(0, 0, 960, 540, 'background', { id: 'field' });
  k.rect(48, 26, 10, 10, 'accent');
  k.text(68, 22, 700, 18, kicker, 12, { role: 'label', color: 'accent', tracking: 1.1 });
  k.text(48, 52, 864, 68, title, 30, { role: 'title', weight: 700, lineHeight: 1.12 });
  k.rect(48, 126, 120, 2, 'accent');
}

function footer(k: Kit): void {
  k.line(48, 500, 912, 500, 'rule', 0.7);
  k.text(48, 508, 760, 18, SOURCE, 11, { role: 'footer', color: 'muted', font: 'body' });
  k.text(820, 508, 92, 18, String(k.index + 1).padStart(2, '0'), 11, { role: 'footer', color: 'muted', align: 'right', font: 'body' });
}

function cover(): Page {
  const k = navy(0);
  k.rect(0, 0, 960, 540, 'background');
  k.rect(48, 36, 12, 12, 'accent');
  k.text(72, 32, 520, 20, 'NAVY BRIEF  /  决策简报', 12, { role: 'label', color: 'accent', tracking: 1.3 });
  k.rect(48, 188, 220, 2, 'accent');
  k.text(48, 208, 560, 120, '把不确定性\n变成可执行决策', 44, { role: 'hero', weight: 700, lineHeight: 1.08 });
  k.text(48, 350, 540, 48, '在全面投入前，先验证\n那条会改写计划的核心假设。', 18, { role: 'body', color: 'muted' });
  k.rect(680, 156, 232, 308, 'surface');
  k.rect(680, 156, 232, 6, 'accent');
  const facts: [string, string][] = [
    ['验证窗口', '6 周'],
    ['回退门槛', '复购 65%'],
    ['冻结项', '投放加码'],
  ];
  facts.forEach(([label, value], i) => {
    const y = 184 + i * 86;
    k.text(700, y, 192, 18, label, 12, { role: 'label', color: 'accent' });
    k.text(700, y + 26, 192, 36, value, 22, { role: 'heading', weight: 700 });
  });
  footer(k);
  return k.page('cover', 'cover', '封面：低位大标题、金线和右侧决策条，不用大红数字块。');
}

function conclusion(): Page {
  const k = navy(1);
  header(k, '01  /  当前主张', '在全面投入前，先验核心假设');
  k.text(48, 150, 864, 28, '四个必须同时成立的条件，缺一条就不应扩店。', 16, { role: 'body', color: 'muted' });
  const items: [string, string, string][] = [
    ['市场', '目标走廊是否重复到店'],
    ['能力', '店长能否独立看懂周报'],
    ['经济性', '毛利能否覆盖班次成本'],
    ['执行', '六周门槛是否写进预算'],
  ];
  items.forEach(([title, body], i) => {
    const x = 48 + (i % 2) * 444;
    const y = 196 + Math.floor(i / 2) * 136;
    k.rect(x, y, 420, 120, 'surface');
    k.rect(x, y, 4, 120, i === 0 ? 'accent' : 'rule');
    k.text(x + 24, y + 18, 80, 24, `0${i + 1}`, 14, { role: 'label', color: 'accent' });
    k.text(x + 24, y + 44, 372, 28, title, 22, { role: 'heading', weight: 700 });
    k.text(x + 24, y + 78, 372, 28, body, 16, { role: 'body', color: 'muted' });
  });
  footer(k);
  return k.page('conclusion', 'conclusion', '结论：四个条件是门槛，不是并列装饰卡片。');
}

function tree(): Page {
  const k = navy(2);
  header(k, '02  /  假设地图', '每个分支都要能单独被否定');
  const levels: [string, string[]][] = [
    ['用户证据', ['到店是否重复', '等待是否过长']],
    ['能力缺口', ['周报能否自制', '库存能否盘清']],
    ['验证成本', ['试点六周预算', '回退条件是否写清']],
  ];
  k.rect(48, 168, 240, 300, 'accent');
  k.text(68, 220, 200, 80, '假设\n扩店可盈利', 24, { role: 'heading', color: 'inverse', weight: 700, align: 'center', lineHeight: 1.2 });
  k.text(68, 330, 200, 72, '先证伪，再扩规模。', 16, { role: 'body', color: 'inverse' });
  levels.forEach(([title, leaves], i) => {
    const y = 168 + i * 104;
    k.line(288, 318, 330, 318, 'accent', 1.2);
    k.line(330, 318, 330, y + 40, 'accent', 1.2);
    k.line(330, y + 40, 360, y + 40, 'accent', 1.2);
    k.rect(360, y, 200, 80, 'surface');
    k.text(376, y + 26, 168, 28, title, 18, { role: 'heading', weight: 700 });
    k.text(588, y + 12, 324, 28, leaves[0], 16, { role: 'body' });
    k.text(588, y + 44, 324, 28, leaves[1], 16, { role: 'body', color: 'muted' });
  });
  footer(k);
  return k.page('evidence-tree', 'evidence-tree', '深色证据树：金色主干，右侧是可检验叶子。');
}

function matrix(): Page {
  const k = navy(3);
  header(k, '03  /  选择', '根据证据选择下一步');
  const cells: [string, string, boolean][] = [
    ['继续研究', '信号不足，先补观察。', false],
    ['优先投入', '先验证假设 B。', true],
    ['持续观察', '低影响，放入观察名单。', false],
    ['安排实施', '证据够了再排期。', false],
  ];
  cells.forEach(([title, body, hot], i) => {
    const x = 48 + (i % 2) * 300;
    const y = 156 + Math.floor(i / 2) * 160;
    k.rect(x, y, 284, 148, hot ? 'accent' : 'surface');
    k.text(x + 20, y + 20, 244, 28, title, 20, { role: 'heading', weight: 700, color: hot ? 'inverse' : 'text' });
    k.text(x + 20, y + 64, 244, 60, body, 16, { role: 'body', color: hot ? 'inverse' : 'muted' });
  });
  k.rect(660, 156, 252, 320, 'wash');
  k.text(680, 180, 212, 20, '建议行动', 12, { role: 'label', color: 'accent' });
  k.text(680, 214, 212, 80, '先验证 B', 28, { role: 'heading', weight: 700 });
  k.text(680, 310, 212, 120, 'B 同时具备高影响\n和更强信号。\n其余候选先保留。', 16, { role: 'body', color: 'muted' });
  footer(k);
  return k.page('matrix', 'matrix', '矩阵：金色只落在被选中的一格。');
}

function waterfall(): Page {
  const k = navy(4);
  header(k, '04  /  价值桥', '把收益与成本放在同一条桥上');
  k.chart(48, 160, 540, 310, {
    kind: 'waterfall',
    categories: ['基期', '规模', '服务', '启动', '结果'],
    series: [{ name: '变动', values: [100, 32, -13, -7, 112], color: 'accent' }],
    showValues: true,
    hideBase: true,
  });
  k.rect(616, 160, 296, 310, 'surface');
  k.text(640, 180, 252, 18, '净结果', 12, { role: 'label', color: 'accent' });
  k.text(640, 210, 252, 70, '+12%', 54, { role: 'number', color: 'accent', weight: 700 });
  k.text(640, 290, 252, 48, '32 点收益里有 20 点\n被成本吃掉。', 16, { role: 'body' });
  const rows: [string, string][] = [['收益', '+32'], ['成本', '−20'], ['净变化', '+12']];
  rows.forEach(([a, b], i) => {
    const y = 350 + i * 34;
    k.text(640, y, 140, 24, a, 14, { role: 'body', color: i === 2 ? 'text' : 'muted', weight: i === 2 ? 700 : 400 });
    k.text(800, y, 88, 24, b, 16, { role: 'heading', align: 'right', weight: 700 });
  });
  footer(k);
  return k.page('waterfall', 'waterfall', '深色瀑布：解读落在右侧面板，不跟柱子抢位置。');
}

function trend(): Page {
  const k = navy(5);
  header(k, '05  /  趋势', '阅读趋势，追问停顿的原因');
  k.chart(48, 156, 864, 210, {
    kind: 'line',
    categories: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
    series: [{ name: '指数', values: [100, 108, 114, 112, 128, 142], color: 'accent' }],
    showValues: true,
  });
  const notes: [string, string, boolean][] = [
    ['W4 停顿', '连续上升后第一次回落，需要解释。', false],
    ['+42%', '期末相对基期的累计变化。', true],
    ['下一步', '先核对第四周班次和库存，而不是加投放。', false],
  ];
  notes.forEach(([title, body, hero], i) => {
    const x = 48 + i * 304;
    k.rect(x, 384, 288, 100, 'surface');
    if (hero) {
      k.text(x + 16, 394, 256, 36, title, 28, { role: 'number', color: 'accent', weight: 700 });
      k.text(x + 16, 436, 256, 36, body, 14, { role: 'body', color: 'muted' });
    } else {
      k.text(x + 16, 396, 256, 22, title, 14, { role: 'label', color: 'accent', weight: 700 });
      k.text(x + 16, 424, 256, 48, body.replace('，', '\n'), 15, { role: 'body' });
    }
  });
  footer(k);
  return k.page('trend-callouts', 'trend-callouts', '趋势在上、解读在下，避免左右挤在一起。');
}

function scorecard(): Page {
  const k = navy(6);
  header(k, '06  /  记分', '把每项指标连接到后续行动');
  const rows: [string, string, string, string, boolean][] = [
    ['完成率', '73%', '> 70%', '保持', false],
    ['等待', '7 min', '< 10', '保持', false],
    ['回访率', '58%', '> 65%', '复核', true],
    ['单次成本', '¥8', '< ¥9', '保持', false],
  ];
  rows.forEach(([name, actual, goal, action, review], i) => {
    const y = 156 + i * 80;
    k.rect(48, y, 864, 70, review ? 'surface' : 'wash');
    k.rect(48, y, 6, 70, review ? 'accent' : 'rule');
    k.text(72, y + 20, 220, 30, name, 18, { role: 'heading', weight: 700 });
    k.text(320, y + 14, 160, 42, actual, 28, { role: 'number', weight: 700, color: review ? 'accent' : 'text' });
    k.text(520, y + 22, 160, 28, goal, 16, { role: 'body', color: 'muted' });
    k.text(720, y + 22, 170, 28, action, 16, { role: 'body', weight: review ? 700 : 400, color: review ? 'accent' : 'muted' });
  });
  footer(k);
  return k.page('scorecard', 'scorecard', '记分：金色只标需要复核的一行。');
}

function gantt(): Page {
  const k = navy(7);
  header(k, '07  /  顺序', '围绕决策门槛安排执行顺序');
  const lanes: [string, string, number, number][] = [
    ['研究', '基线与范围', 0.0, 1.1],
    ['运营', '小规模试点', 0.7, 1.5],
    ['分析', '评估证据', 2.1, 1.1],
    ['负责人', '决定下一步', 3.1, 0.85],
  ];
  ['W1–2', 'W3–4', 'W5–6', 'W7–8'].forEach((label, i) => k.text(260 + i * 168, 150, 150, 18, label, 12, { role: 'label', color: 'muted' }));
  lanes.forEach(([owner, title, start, length], i) => {
    const y = 180 + i * 72;
    k.rect(48, y, 864, 64, 'wash');
    k.text(60, y + 10, 180, 22, owner, 12, { role: 'label', color: 'accent' });
    k.text(60, y + 32, 180, 22, title, 16, { role: 'heading', weight: 700 });
    k.rect(260 + start * 168, y + 20, length * 168, 24, i === 2 ? 'accent' : 'secondary');
  });
  k.line(596, 174, 596, 468, 'accent', 1.5);
  footer(k);
  return k.page('gantt', 'gantt', '深色泳道甘特：门槛是竖线，不是又一张卡片。');
}

function architecture(): Page {
  const k = navy(8);
  header(k, '08  /  系统', '让交接顺序可以被检查');
  const cols = ['接入', '处理', '履约', '观测'];
  const cells = [
    ['订单', '调度', '配送', '等待'],
    ['库存', '分拣', '签收', '异常'],
    ['规则', '排队', '回访', '复盘'],
  ];
  cols.forEach((col, i) => k.text(48 + i * 168, 154, 150, 22, col, 13, { role: 'label', color: 'accent', align: 'center' }));
  cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      const x = 48 + c * 168;
      const y = 186 + r * 88;
      k.rect(x, y, 150, 72, r === 1 ? 'accent' : 'surface');
      k.text(x + 8, y + 22, 134, 28, cell, 16, { role: 'heading', weight: 700, color: r === 1 ? 'inverse' : 'text', align: 'center' });
    });
  });
  k.rect(732, 186, 180, 248, 'wash');
  k.text(748, 206, 148, 72, '先暴露失败路径', 20, { role: 'heading', weight: 700 });
  k.text(748, 290, 148, 120, '中间一行是\n当前主路径。\n上下两行不能空。', 15, { role: 'body', color: 'muted' });
  footer(k);
  return k.page('architecture', 'architecture', '架构：四列主路径，金色行是正在跑的一层。');
}

function compare(): Page {
  const k = navy(9);
  header(k, '09  /  对照', '小范围改变，可衡量的结果');
  k.rect(48, 156, 420, 320, 'surface');
  k.rect(492, 156, 420, 320, 'surface');
  k.rect(48, 156, 420, 8, 'muted');
  k.rect(492, 156, 420, 8, 'accent');
  k.text(72, 180, 372, 20, '试点前', 12, { role: 'label', color: 'muted' });
  k.text(516, 180, 372, 20, '试点后', 12, { role: 'label', color: 'accent' });
  k.text(72, 214, 372, 48, '等待 18 分钟', 24, { role: 'heading', weight: 700 });
  k.text(516, 214, 372, 48, '等待 7 分钟', 24, { role: 'heading', weight: 700, color: 'accent' });
  k.text(72, 280, 372, 48, '完成率 46%', 20, { role: 'body' });
  k.text(516, 280, 372, 48, '完成率 73%', 20, { role: 'body' });
  k.text(72, 350, 372, 80, '下一步不清晰，\n交接后常停住。', 16, { role: 'body', color: 'muted' });
  k.text(516, 350, 372, 80, '任务定义不变，\n只让下一位负责人可见。', 16, { role: 'body', color: 'muted' });
  footer(k);
  return k.page('case-compare', 'case-compare', '对照：左右是同一口径的前后状态，不是两个产品卖点。');
}

function funnel(): Page {
  const k = navy(10);
  header(k, '10  /  漏斗', '沿同一群体看转化，而不是混口径');
  const steps: [string, string, number][] = [
    ['触达', '1,000', 864],
    ['进店', '640', 700],
    ['成交', '360', 520],
    ['复购', '216', 340],
  ];
  steps.forEach(([name, count], i) => {
    const y = 156 + i * 80;
    const w = steps[i][2];
    k.rect(48, y, w, 64, i === 2 ? 'accent' : 'surface');
    k.text(68, y + 16, 160, 32, name, 18, { role: 'heading', weight: 700, color: i === 2 ? 'inverse' : 'text' });
    k.text(w - 80, y + 14, 100, 36, count, 24, { role: 'number', weight: 700, color: i === 2 ? 'inverse' : 'accent', align: 'right' });
  });
  footer(k);
  return k.page('funnel', 'funnel', '横向漏斗：宽度随规模下降，成交是唯一强调步。');
}

function closing(): Page {
  const k = navy(11);
  k.rect(0, 0, 960, 540, 'background');
  k.rect(48, 160, 180, 2, 'accent');
  k.text(48, 36, 400, 18, '12  /  行动', 12, { role: 'label', color: 'accent' });
  k.text(48, 180, 800, 100, '先验证核心假设。\n再决定是否扩店。', 36, { role: 'hero', weight: 700, lineHeight: 1.12 });
  const items = ['W6 之前不增加投放。', '复购不到 65% 就回退。'];
  items.forEach((item, i) => {
    const y = 320 + i * 64;
    k.text(48, y, 64, 32, `0${i + 1}`, 22, { role: 'number', color: 'accent', weight: 700 });
    k.text(124, y + 4, 700, 28, item, 18, { role: 'body' });
  });
  k.text(48, 508, 760, 18, SOURCE, 11, { role: 'footer', color: 'muted' });
  k.text(820, 508, 92, 18, '12', 11, { role: 'footer', color: 'muted', align: 'right' });
  return k.page('closing', 'closing', '收束：金线加大标题，只留一个决定和两条行动。');
}

export function buildNavyBriefDeck(): Deck {
  const pages = [cover, conclusion, tree, matrix, waterfall, trend, scorecard, gantt, architecture, compare, funnel, closing].map(fn => fn());
  return deckShell(navyBriefTheme, pages, 'Navy Brief 参考页');
}
