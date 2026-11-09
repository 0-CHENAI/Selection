import { describe, expect, test } from 'bun:test'
import { chartBackend, chartSkillInstructions, isChartSkill, listChartSkills, nativeChartNotice, type ChartSkillCandidate } from '../chart-skills'

const installed: ChartSkillCandidate = {
  slug: 'lieflat-charts',
  source: 'workspace',
  metadata: { name: 'lieflat-charts', description: '数据可视化，支持自定义色板。' },
  content: 'Emit one SVG chart. Accept a custom palette of hex colors.',
}

const keyword: ChartSkillCandidate = {
  slug: 'ink-plots',
  source: 'global',
  metadata: { name: 'Ink Plots', description: 'A chart sketch skill.' },
}

const prose: ChartSkillCandidate = {
  slug: 'meeting-notes',
  source: 'workspace',
  metadata: { name: '会议记录', description: '整理会议纪要。' },
}

const bundled: ChartSkillCandidate = {
  slug: 'officecli-data-dashboard',
  source: 'bundled',
  metadata: { name: 'Dashboard', description: 'CSV to dashboard and data visualization.' },
}

const cjk: ChartSkillCandidate = {
  slug: 'mo-tu',
  source: 'project',
  metadata: { name: '墨图集', description: 'chart sketches' },
}

describe('chart skill detection', () => {
  test('recognizes the known slug and chart keywords, and hides bundled guides', () => {
    expect(isChartSkill(installed)).toBe(true)
    expect(isChartSkill(keyword)).toBe(true)
    expect(isChartSkill({ slug: 'viz', source: 'project', metadata: { name: '视图', description: '数据可视化' } })).toBe(true)
    expect(isChartSkill(prose)).toBe(false)
    expect(isChartSkill(bundled)).toBe(false)
    expect(isChartSkill({ slug: 'ppt-design', source: 'workspace', metadata: { name: 'PPT', description: '制作图表' } })).toBe(false)
    expect(listChartSkills([])).toEqual([])
    expect(listChartSkills([prose, bundled])).toEqual([])
    expect(listChartSkills([keyword, installed, installed, prose])).toEqual([
      expect.objectContaining({ slug: 'ink-plots', customPalette: false }),
      expect.objectContaining({ slug: 'lieflat-charts', customPalette: true }),
    ])
  })

  test('calls a chart skill only when the request names it', () => {
    expect(chartBackend(undefined, [installed])).toEqual({ mode: 'native' })
    expect(chartBackend('画个图表', [installed, keyword])).toEqual({ mode: 'native' })
    expect(chartBackend('draw a chart', [installed])).toEqual({ mode: 'native' })
    expect(chartBackend('做一张数据可视化', [installed])).toEqual({ mode: 'native' })
    expect(chartBackend('用 my-lieflat-charts 画图', [installed])).toEqual({ mode: 'native' })
    expect(chartBackend('用 lieflat-charts 画图', [installed])).toMatchObject({ mode: 'external', skill: { slug: 'lieflat-charts' } })
    expect(chartBackend('用 LIEFLAT-CHARTS 画图', [installed])).toMatchObject({ mode: 'external', skill: { slug: 'lieflat-charts' } })
    expect(chartBackend('图表用 Ink Plots 技能', [keyword])).toMatchObject({ mode: 'external', skill: { slug: 'ink-plots' } })
    expect(chartBackend('图表用墨图集技能', [cjk])).toMatchObject({ mode: 'external', skill: { slug: 'mo-tu' } })
    expect(chartBackend('先用 ink-plots，再提 lieflat-charts', [installed, keyword]).skill?.slug).toBe('ink-plots')
    expect(chartBackend('用 lieflat-charts 画图', [])).toEqual({ mode: 'native', fallback: { skill: 'lieflat-charts', reason: 'missing' } })
    expect(chartBackend('用 lieflat-charts 画图', [installed], { ok: false, reason: 'timeout' })).toMatchObject({ mode: 'native', fallback: { skill: 'lieflat-charts', reason: 'timeout' } })
    expect(chartBackend('用 lieflat-charts 画图', [installed], { ok: false, reason: 'error' }).fallback?.reason).toBe('error')
    const text = chartSkillInstructions(listChartSkills([installed])[0]!, { paper: '#F7F7F5', ink: '#141414', accent: '#C8102E' }, '#123456')
    expect(text).toContain('lieflat-charts')
    expect(text).toContain('#F7F7F5')
    expect(text).toContain('#123456')
    expect(text).not.toContain('#C8102E')
    expect(text).toContain('standalone SVG')
    expect(text).toContain('chartImage')
    expect(text).toContain('speaker notes')
    expect(text).toContain('native editable chart')
    expect(text).not.toContain('templates/color')
    const idle = nativeChartNotice([installed, keyword])
    expect(idle).toContain('ink-plots (Ink Plots)')
    expect(idle).toContain('lieflat-charts')
    expect(idle.toLowerCase()).toContain('do not ask')
    expect(nativeChartNotice([])).toContain('No chart skills are installed.')
  })
})
