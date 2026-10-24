import { describe, expect, test } from 'bun:test'
import { chartBackend, chartSkillInstructions, chartStyleVisible, isChartSkill, listChartSkills, type ChartSkillCandidate } from '../chart-skills'

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

describe('chart skill detection', () => {
  test('recognizes the known slug and chart keywords, and hides bundled guides', () => {
    expect(isChartSkill(installed)).toBe(true)
    expect(isChartSkill(keyword)).toBe(true)
    expect(isChartSkill({ slug: 'viz', source: 'project', metadata: { name: '视图', description: '数据可视化' } })).toBe(true)
    expect(isChartSkill(prose)).toBe(false)
    expect(isChartSkill(bundled)).toBe(false)
    expect(isChartSkill({ slug: 'ppt-design', source: 'workspace', metadata: { name: 'PPT', description: '制作图表' } })).toBe(false)
    expect(chartStyleVisible([])).toBe(false)
    expect(chartStyleVisible([prose, bundled])).toBe(false)
    expect(listChartSkills([keyword, installed, installed, prose])).toEqual([
      expect.objectContaining({ slug: 'ink-plots', customPalette: false }),
      expect.objectContaining({ slug: 'lieflat-charts', customPalette: true }),
    ])
  })

  test('falls back to a native chart when the skill is missing, errors, or times out', () => {
    expect(chartBackend(undefined, [installed])).toEqual({ mode: 'native' })
    expect(chartBackend({ chartSkill: 'lieflat-charts' }, [installed])).toMatchObject({ mode: 'external', skill: { slug: 'lieflat-charts' } })
    expect(chartBackend({ chartSkill: 'lieflat-charts' }, [])).toEqual({ mode: 'native', fallback: { skill: 'lieflat-charts', reason: 'missing' } })
    expect(chartBackend({ chartSkill: 'lieflat-charts' }, [installed], { ok: false, reason: 'timeout' })).toMatchObject({ mode: 'native', fallback: { skill: 'lieflat-charts', reason: 'timeout' } })
    expect(chartBackend({ chartSkill: 'lieflat-charts' }, [installed], { ok: false, reason: 'error' }).fallback?.reason).toBe('error')
    const text = chartSkillInstructions(listChartSkills([installed])[0]!, { paper: '#F7F7F5', ink: '#141414', accent: '#C8102E' }, '#123456')
    expect(text).toContain('lieflat-charts')
    expect(text).toContain('#F7F7F5')
    expect(text).toContain('#123456')
    expect(text).toContain('standalone SVG')
    expect(text).toContain('chartImage')
    expect(text).toContain('speaker notes')
    expect(text).toContain('native editable chart')
    expect(text).not.toContain('templates/color')
  })
})
