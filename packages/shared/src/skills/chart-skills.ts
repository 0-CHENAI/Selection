import type { PptChartFallback, PptRequest } from '../protocol/ppt'

/**
 * Slugs we already know are chart skills. This list is only a name.
 * Those skills stay on the user's machine. Nothing from them is copied here.
 */
export const KNOWN_CHART_SKILL_SLUGS = ['lieflat-charts'] as const

const CHART_TEXT = /chart|图表|数据可视化|data\s*visualization/i
const CUSTOM_PALETTE = /custom[\s_-]*(palette|colou?rs?)|自定义\s*色板|自定义\s*配色/i
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

export function chartStyleVisible(skills: ChartSkillCandidate[]): boolean {
  return listChartSkills(skills).length > 0
}

export function chartBackend(
  request: Pick<PptRequest, 'chartSkill'> | undefined,
  skills: ChartSkillCandidate[],
  outcome?: { ok: true } | { ok: false; reason: 'timeout' | 'error' },
): ChartBackend {
  const slug = request?.chartSkill
  if (!slug) return { mode: 'native' }
  const skill = listChartSkills(skills).find(item => item.slug === slug)
  if (!skill) return { mode: 'native', fallback: { skill: slug, reason: 'missing' } }
  if (outcome && !outcome.ok) return { mode: 'native', skill, fallback: { skill: skill.slug, reason: outcome.reason } }
  return { mode: 'external', skill }
}

/** Instructions for the agent. They name the installed skill; they do not include its source. */
export function chartSkillInstructions(skill: ChartSkillChoice, colors: Record<string, string> | undefined, brandColor?: string): string {
  const lines = [
    `Chart style: external skill ${skill.slug} (${skill.name}). Invoke that installed skill for each chart. Do not copy the skill into this repository, and do not let it replace the deck with its own presentation or report.`,
    'Prefer a standalone SVG. If the skill cannot emit SVG, export a high-resolution PNG whose long edge is at least 1600 px.',
    'Place the file as an image on the chart slot bounds, with fit fill. Set chartImage to { skill, format: "svg" or "png", data }, where data is the original table. Copy that same table into the page notes so it becomes speaker notes.',
    'The picture is not editable inside PowerPoint. The notes are what a later edit uses.',
    'If the skill errors or does not finish, draw a native editable chart instead. Record {"fallbacks":[{"skill":"<slug>","reason":"error" or "timeout","page":<1-based>}]} in the session chart-fallback file named below.',
  ]
  if (skill.customPalette) {
    const palette = { ...(colors ?? {}) }
    if (brandColor) palette.accent = brandColor
    lines.push(Object.keys(palette).length
      ? `This skill accepts a custom palette. Pass these theme colors through the skill's own palette fields: ${JSON.stringify(palette)}`
      : 'This skill accepts a custom palette. Pass the locked template theme colors through the skill\'s own palette fields.')
  } else if (brandColor) {
    lines.push(`Use brand color ${brandColor} as the chart accent when the skill can take a color.`)
  }
  return lines.join('\n')
}
