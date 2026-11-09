/**
 * 个人办公与公文的文种路由。
 *
 * 常驻上下文只保留技能目录里的一行描述。命中后由宿主注入对应 SKILL.md，
 * 不在系统提示里堆正文。一次只返回一个文种；两种都像时返回空，避免误加载。
 */

export interface OfficeDocumentRoute {
  /** 稳定的文种 id，供测试和注入使用。 */
  id: string
  /** 要注入的业务技能。 */
  slug: string
  format: 'word' | 'excel'
  /** 公文法定文种。个人办公类型没有这一项。 */
  docKind?: string
}

export const OFFICE_DOCUMENT_ROUTE_TABLE = [
  { id: 'contract', slug: 'personal-contract', format: 'word' },
  { id: 'resume', slug: 'personal-resume', format: 'word' },
  { id: 'quotation', slug: 'personal-quotation', format: 'excel' },
  { id: 'budget', slug: 'personal-budget', format: 'excel' },
  { id: 'statement', slug: 'personal-statement', format: 'excel' },
  { id: 'gantt', slug: 'personal-gantt', format: 'excel' },
  { id: 'application', slug: 'personal-application', format: 'word' },
  { id: 'invitation', slug: 'personal-invitation', format: 'word' },
  { id: 'okr', slug: 'personal-okr', format: 'excel' },
  { id: 'prd', slug: 'personal-prd', format: 'word' },
  { id: 'letter', slug: 'personal-letter', format: 'word' },
  { id: 'gov-doc', slug: 'gov-doc-writing', format: 'word' },
] as const satisfies readonly OfficeDocumentRoute[]

const SLUG_BY_ID = new Map(OFFICE_DOCUMENT_ROUTE_TABLE.map(item => [item.id, item]))

function compact(message: string): string {
  return message.replace(/\s+/g, '').toLowerCase()
}

/** 幻灯片请求留给 PPT 轨道，除非同时点名 Word / Excel。 */
function isSlideRequest(text: string): boolean {
  if (!/幻灯片|演示文稿|路演稿|\bppt\b|pptx/.test(text)) return false
  return !/(?:word|excel|docx|xlsx|表格|文档)/.test(text)
}

function best(text: string, strong: readonly string[], medium: readonly string[] = []): number {
  if (strong.some(phrase => text.includes(phrase))) return 10
  if (medium.some(phrase => text.includes(phrase))) return 4
  return 0
}

function scoreContract(text: string): number {
  if (/劳动合同法|合同法/.test(text) && !/[写做拟草]/.test(text) && !/一份|个合同|合同草案/.test(text)) return 0
  const strong = best(text, ['租房合同', '租赁合同', '房屋租赁', '劳务合同', '劳务协议', '采购合同', '保密协议', '劳动合同', '合同草案'])
  if (strong) return strong
  if (/协议栈|通信协议|网络协议/.test(text)) return 0
  return best(text, [], ['合同', '协议'])
}

function scoreResume(text: string): number {
  return best(text, ['求职信', '简历', '履历', '求职'], ['应聘'])
}

function scoreQuotation(text: string): number {
  return best(text, ['报价单', '报价表', '采购报价'], ['报价'])
}

function scoreBudget(text: string): number {
  const strong = best(text, ['家庭预算', '个人预算', '家庭年度预算', '家庭收支', '家庭记账', '记账表'])
  if (strong) return strong
  if (/记账|收支/.test(text)) return 8
  if (text.includes('预算') && !/项目计划|甘特|okr|绩效/.test(text)) return 4
  return 0
}

function scoreStatement(text: string): number {
  return best(text, ['对账单', '对一下账', '对账', '往来对账'])
}

function scoreGantt(text: string): number {
  const strong = best(text, ['甘特', '项目计划', '排班'])
  if (strong) return strong
  if (/工期/.test(text) && /项目|计划|排期/.test(text)) return 6
  return 0
}

function scoreApplication(text: string): number {
  return best(text, ['报销', '请假', '申请表', '用印'])
}

function scoreInvitation(text: string): number {
  return best(text, ['邀请函', '请柬', '议程', '年会邀请'])
}

function scoreOkr(text: string): number {
  return best(text, ['okr', '绩效考核', '考核表', '目标与关键结果', '绩效'])
}

function scorePrd(text: string): number {
  return best(text, ['prd', '产品需求', '用户故事'])
}

function scoreLetter(text: string): number {
  if (/求职|简历|履历/.test(text)) return 0
  return best(text, ['商务信', '商务函', '英文信', '合作邀约', '英文商务'])
}

function scoreGov(text: string): number {
  const hits: number[] = []
  if (/关于[^。\n]{0,40}的(通知|决定|请示|报告|批复|通报|通告|公告|意见)/.test(text)) hits.push(12)
  if (['请示', '批复', '通报', '通告', '公告', '公报', '决议', '议案', '商洽函', '复函', '公文', '发文字号', '红头', '主送机关'].some(phrase => text.includes(phrase))) hits.push(10)
  if (/的决定|决定如下|表彰决定/.test(text)) hits.push(10)
  if (/任免命令|嘉奖令|命令/.test(text) && !/命令行|命令提示符/.test(text)) hits.push(10)
  if (/关于[^。\n]{0,40}的意见|指导意见|实施意见/.test(text)) hits.push(10)
  if (/纪要/.test(text) && /公文|机关|发文/.test(text)) hits.push(10)
  if (/情况报告/.test(text) && !/调研报告|研究报告/.test(text)) hits.push(10)
  if (!/通知一下|群通知|微信通知/.test(text) && text.includes('通知')) hits.push(4)
  if (!/工作报告|周报|月报|日报|调研报告|研究报告|述职/.test(text) && text.includes('报告')) hits.push(4)
  if (/讲话稿|领导讲话|述职|对照检查|简报/.test(text)) hits.push(10)
  if (/工作方案|实施方案|活动方案/.test(text)) hits.push(10)
  if (!/邀请函|请柬|商务函|商务信|求职信/.test(text) && /公函|来函|去函|函复|的函/.test(text)) hits.push(8)
  return hits.length ? Math.max(...hits) : 0
}

type OfficeRouteId = (typeof OFFICE_DOCUMENT_ROUTE_TABLE)[number]['id']

const SCORERS: Array<{ id: OfficeRouteId; score: (text: string) => number }> = [
  { id: 'resume', score: scoreResume },
  { id: 'letter', score: scoreLetter },
  { id: 'invitation', score: scoreInvitation },
  { id: 'application', score: scoreApplication },
  { id: 'quotation', score: scoreQuotation },
  { id: 'statement', score: scoreStatement },
  { id: 'budget', score: scoreBudget },
  { id: 'gantt', score: scoreGantt },
  { id: 'okr', score: scoreOkr },
  { id: 'prd', score: scorePrd },
  { id: 'contract', score: scoreContract },
  { id: 'gov-doc', score: scoreGov },
]

const GOV_KINDS: Array<{ kind: string; test: (text: string) => boolean }> = [
  { kind: '讲话稿', test: text => text.includes('讲话稿') || text.includes('领导讲话') },
  { kind: '述职', test: text => text.includes('述职') },
  { kind: '对照检查', test: text => text.includes('对照检查') },
  { kind: '简报', test: text => text.includes('简报') },
  { kind: '方案', test: text => /工作方案|实施方案|活动方案/.test(text) },
  { kind: '批复', test: text => text.includes('批复') },
  { kind: '请示', test: text => text.includes('请示') },
  { kind: '通报', test: text => text.includes('通报') },
  { kind: '通告', test: text => text.includes('通告') },
  { kind: '公告', test: text => text.includes('公告') },
  { kind: '公报', test: text => text.includes('公报') },
  { kind: '决议', test: text => text.includes('决议') },
  { kind: '命令', test: text => /任免命令|嘉奖令|命令/.test(text) && !/命令行|命令提示符/.test(text) },
  { kind: '决定', test: text => /的决定|决定如下|表彰决定/.test(text) },
  { kind: '意见', test: text => /的意见|指导意见|实施意见/.test(text) },
  { kind: '议案', test: text => text.includes('议案') },
  { kind: '纪要', test: text => text.includes('纪要') },
  { kind: '函', test: text => /商洽函|复函|公函|来函|去函|函复|的函/.test(text) },
  { kind: '通知', test: text => text.includes('通知') },
  { kind: '报告', test: text => text.includes('报告') },
]

function govKind(text: string): string | undefined {
  return GOV_KINDS.find(item => item.test(text))?.kind
}

/** 当前这句话对应的文种。幻灯片、闲聊和两种同样强的请求不命中。 */
export function routeOfficeDocument(message: string): OfficeDocumentRoute | null {
  const text = compact(message)
  if (!text || isSlideRequest(text)) return null
  const ranked = SCORERS
    .map(item => ({ id: item.id, score: item.score(text) }))
    .filter(item => item.score >= 4)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const top = ranked[0]
  if (!top) return null
  const second = ranked[1]
  if (second && second.score === top.score) return null
  const base = SLUG_BY_ID.get(top.id)
  if (!base) return null
  if (base.id !== 'gov-doc') return { id: base.id, slug: base.slug, format: base.format }
  return { id: base.id, slug: base.slug, format: base.format, docKind: govKind(text) }
}

/**
 * 本轮路由。当前句优先；Office 模式里的短跟进（「把押金改成两个月」）沿用本会话最近一次文种。
 * 普通聊天不沿用历史，避免一份旧合同把后面的闲聊也灌进合同技能。
 */
export function routeOfficeDocumentTurn(input: {
  message: string
  history?: readonly string[]
  officeMode?: boolean
}): OfficeDocumentRoute | null {
  const current = routeOfficeDocument(input.message)
  if (current) return current
  if (!input.officeMode) return null
  const history = input.history ?? []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const prior = history[index]
    if (!prior || prior === input.message) continue
    const hit = routeOfficeDocument(prior)
    if (hit) return hit
  }
  return null
}
