import type { PptChartFallback } from '../protocol/ppt'

/**
 * Slugs we already know are chart skills. This list is only a name.
 * Those skills stay on the user's machine. Nothing from them is copied here.
 */
export const KNOWN_CHART_SKILL_SLUGS = ['lieflat-charts'] as const

const CHART_TEXT = /chart|图表|数据可视化|data\s*visualization/i
const CUSTOM_PALETTE = /custom[\s_-]*(palette|colou?rs?)|自定义\s*色板|自定义\s*配色/i
const GENERIC_CHART_NAME = /^(?:charts?|graphs?|plots?|visualization|visualisation|data\s*visuali[sz]ation|图表|数据可视化|可视化)$/i
export const CHART_SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface ChartSkillCandidate {
  slug: string
  source?: 'bundled' | 'global' | 'workspace' | 'project' | string
  content?: string
  displayTitle?: string
  metadata?: { name?: string; description?: string }
  name?: string
  description?: string
}

export interface ChartSkillChoice {
  slug: string
  name: string
  description: string
  customPalette: boolean
}

export interface ChartBackend {
  mode: 'native' | 'external'
  skill?: ChartSkillChoice
  fallback?: PptChartFallback
}

function fields(skill: ChartSkillCandidate): { name: string; description: string; body: string } {
  return {
    name: skill.displayTitle || skill.metadata?.name || skill.name || skill.slug,
    description: skill.metadata?.description || skill.description || '',
    body: skill.content ?? '',
  }
}

/** User-installed chart skills only. Bundled guides that mention charts stay hidden. */
export function isChartSkill(skill: ChartSkillCandidate): boolean {
  if (!skill?.slug || skill.source === 'bundled' || skill.slug === 'ppt-design') return false
  if ((KNOWN_CHART_SKILL_SLUGS as readonly string[]).includes(skill.slug)) return true
  const { name, description } = fields(skill)
  return CHART_TEXT.test(`${skill.slug}\n${name}\n${description}`)
}

export function listChartSkills(skills: ChartSkillCandidate[]): ChartSkillChoice[] {
  const seen = new Set<string>()
  const choices: ChartSkillChoice[] = []
  for (const skill of skills) {
    if (!isChartSkill(skill) || seen.has(skill.slug)) continue
    seen.add(skill.slug)
    const { name, description, body } = fields(skill)
    choices.push({
      slug: skill.slug,
      name,
      description,
      customPalette: CUSTOM_PALETTE.test(`${description}\n${body}`),
    })
  }
  return choices.sort((left, right) => left.slug.localeCompare(right.slug))
}

/** Index of an explicit name. Generic words such as "chart" or "图表" do not count. */
function mentionAt(text: string, needle: string, kind: 'slug' | 'name'): number {
  const trimmed = needle.trim()
  if (trimmed.length < 3 || GENERIC_CHART_NAME.test(trimmed)) return -1
  const hay = text.toLowerCase()
  const pin = trimmed.toLowerCase()
  const cjkName = kind === 'name' && /[^\u0000-\u007f]/.test(trimmed)
  let from = 0
  while (from < hay.length) {
    const at = hay.indexOf(pin, from)
    if (at < 0) return -1
    if (cjkName) return at
    const before = at > 0 ? hay.charAt(at - 1) : ''
    const after = at + pin.length < hay.length ? hay.charAt(at + pin.length) : ''
    if (!/[a-z0-9-]/.test(before) && !/[a-z0-9-]/.test(after)) return at
    from = at + 1
  }
  return -1
}

/** The skill the user named in this request, if any. A known slug that is not installed has no skill. */
function namedChartSkill(message: string | undefined, skills: ChartSkillCandidate[]): { slug: string; skill?: ChartSkillChoice } | undefined {
  const text = message ?? ''
  if (!text.trim()) return undefined
  const hits: Array<{ slug: string; index: number; skill?: ChartSkillChoice }> = []
  for (const skill of listChartSkills(skills)) {
    const indexes = [mentionAt(text, skill.slug, 'slug'), mentionAt(text, skill.name, 'name')].filter(index => index >= 0)
    if (indexes.length) hits.push({ slug: skill.slug, index: Math.min(...indexes), skill })
  }
  for (const slug of KNOWN_CHART_SKILL_SLUGS) {
    if (hits.some(hit => hit.slug === slug)) continue
    const index = mentionAt(text, slug, 'slug')
    if (index >= 0) hits.push({ slug, index })
  }
  hits.sort((left, right) => left.index - right.index || left.slug.localeCompare(right.slug))
  const first = hits[0]
  return first ? { slug: first.slug, skill: first.skill } : undefined
}

export function chartBackend(
  message: string | undefined,
  skills: ChartSkillCandidate[],
  outcome?: { ok: true } | { ok: false; reason: 'timeout' | 'error' },
): ChartBackend {
  const named = namedChartSkill(message, skills)
  if (!named) return { mode: 'native' }
  if (!named.skill) return { mode: 'native', fallback: { skill: named.slug, reason: 'missing' } }
  if (outcome && !outcome.ok) return { mode: 'native', skill: named.skill, fallback: { skill: named.skill.slug, reason: outcome.reason } }
  return { mode: 'external', skill: named.skill }
}

/** Tells the agent which chart skills exist, and that a missing mention means native charts. */
export function nativeChartNotice(skills: ChartSkillCandidate[]): string {
  const installed = listChartSkills(skills)
  const known = installed.length
    ? `Installed chart skills: ${installed.map(skill => skill.name.toLowerCase() === skill.slug.toLowerCase() ? skill.slug : `${skill.slug} (${skill.name})`).join(', ')}.`
    : 'No chart skills are installed.'
  return `${known} Draw native editable charts. Do not call a chart skill unless the user explicitly named it in this request, and do not ask whether to use one.`
}

/** Instructions for the agent. They name the installed skill; they do not include its source. */
export function chartSkillInstructions(skill: ChartSkillChoice, colors: Record<string, string> | undefined, brandColor?: string): string {
  const lines = [
    `The user explicitly named installed chart skill ${skill.slug} (${skill.name}). Invoke that skill for each chart. Do not copy the skill into this repository, and do not let it replace the deck with its own presentation or report. Do not ask the user to confirm the choice.`,
    'Prefer a standalone SVG. If the skill cannot emit SVG, export a high-resolution PNG whose long edge is at least 1600 px.',
    'Place the file as an image on the chart slot bounds, with fit fill. Set chartImage to { skill, format: "svg" or "png", data }, where data is the original table. Copy that same table into the page notes so it becomes speaker notes.',
    'The picture is not editable inside PowerPoint. The notes are what a later edit uses.',
    'If the skill errors or does not finish, draw a native editable chart instead. Record {"fallbacks":[{"skill":"<slug>","reason":"error" or "timeout","page":<1-based>}]} in the session chart-fallback file named below.',
  ]
  const palette = { ...(colors ?? {}) }
  if (brandColor) palette.accent = brandColor
  if (Object.keys(palette).length) {
    lines.push(skill.customPalette
      ? `This skill accepts a custom palette. Pass these theme colors through the skill's own palette fields: ${JSON.stringify(palette)}`
      : `Apply these template theme colors to the chart: ${JSON.stringify(palette)}`)
  } else if (skill.customPalette) {
    lines.push('This skill accepts a custom palette. Pass the locked template theme colors through the skill\'s own palette fields.')
  }
  return lines.join('\n')
}
