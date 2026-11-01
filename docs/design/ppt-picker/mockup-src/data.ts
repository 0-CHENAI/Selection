import templatesRaw from './templates.json'
import themesRaw from './themes.json'

export interface Tpl { id: string; title: string; cat: string; canvas: string; pages: number; thumb: string; style: string }
const CAT_MAP: Record<string, string> = { '经营复盘': '商务', '产品发布': '技术', '事故复盘': '技术' }
export const TEMPLATES: Tpl[] = (templatesRaw as Tpl[]).map(t => ({ ...t, cat: CAT_MAP[t.cat] ?? t.cat }))
export const byId = (id: string) => TEMPLATES.find(t => t.id === id)!
export const THEMES = Object.entries(themesRaw as Record<string, { name: string; paper: string; ink: string; accent: string; signal: string }>).map(([id, v]) => ({ id, ...v }))
export const CATEGORIES = ['全部', '商务', '咨询', '学术', '教学', '技术', '创意', '社媒', '自定义'] as const

// Curated order for the 全部 tab: a mix across categories, Chinese titles first.
// Product picker ids are dsh-cartesian, ppt169_china_economy_2025_briefing, mbb-consulting,
// operating-review, dsh-engineering-blueprint, dsh-course-workshop. This mockup still
// names the two ppt-master decks by their example ids, which share those covers.
export const HOME_ORDER = [
  'dsh-cartesian', 'ppt169_china_economy_2025_briefing', 'ppt169_ev_market_priorities', 'ppt169_apple_fy2025_review', 'dsh-engineering-blueprint', 'dsh-course-workshop',
]

export const HISTORY = [
  { id: 'h1', title: '2025 宏观经济简报（管理层）', time: '刚刚', thumb: '/mockup-assets/thumbs/ppt169_china_economy_2025_briefing.webp', pages: 17 },
  { id: 'h2', title: '新员工信息安全培训', time: '2小时', thumb: '/mockup-assets/thumbs/ppt169_infosec_training_zh_long.webp', pages: 22 },
  { id: 'h3', title: 'Raft 共识算法分享会', time: '昨天', thumb: '/mockup-assets/thumbs/ppt169_raft_consensus_deepdive.webp', pages: 18 },
  { id: 'h4', title: '中秋活动方案 · 社区版', time: '3天', thumb: '/mockup-assets/thumbs/ppt169_mid_autumn_papercut.webp', pages: 12 },
  { id: 'h5', title: '电动车市场优先级决策', time: '5天', thumb: '/mockup-assets/thumbs/ppt169_ev_market_priorities.webp', pages: 16 },
  { id: 'h6', title: '睡眠科普 · 初二生物', time: '1周', thumb: '/mockup-assets/thumbs/ppt43_sleep_science_explainer.webp', pages: 10 },
  { id: 'h7', title: '小红书 · 宋人点茶图文', time: '2周', thumb: '/mockup-assets/thumbs/xiaohongshu_song_diancha.webp', pages: 9 },
]

export const DECK = ['01_cover','02_overview','03_gdp_growth','04_industry_share','05_demand_contribution','06_population_structure','07_population_change','08_employment_income','09_consumption','10_investment','11_foreign_trade','12_trade_partners','13_energy_green','14_innovation_digital','15_livelihood','16_key_takeaways','17_sources'].map(n => `/mockup-assets/deck/${n}.svg`)
