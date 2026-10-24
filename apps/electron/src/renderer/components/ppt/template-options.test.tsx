import { beforeAll, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import type { ChartSkillChoice } from '@craft-agent/shared/skills'
import { TemplateOptions } from './TemplateOptions'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } } })
})

const skill: ChartSkillChoice = { slug: 'lieflat-charts', name: 'lieflat-charts', description: '数据可视化', customPalette: true }

function html(skills: ChartSkillChoice[]) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TemplateOptions request={{ templateId: 'dsh-cartesian' }} themes={[]} chartSkills={skills} onChange={() => {}} />
    </I18nextProvider>,
  )
}

describe('chart style menu', () => {
  it('stays hidden when no chart skill is installed', () => {
    const markup = html([])
    expect(markup).toContain('主题色')
    expect(markup).toContain('画幅比例')
    expect(markup).not.toContain('图表样式')
    expect(markup).not.toContain('data-testid="ppt-chart-style"')
  })

  it('offers native charts and each installed chart skill', () => {
    const markup = html([skill])
    expect(markup).toContain('data-testid="ppt-chart-style"')
    expect(markup).toContain('图表样式')
    expect(markup).toContain('原生可编辑')
    expect(markup).toContain('lieflat-charts（设计感更强，插入为矢量图，数据不可在 PPT 内编辑）')
    expect(markup).toContain('aria-checked="true"')
  })
})
