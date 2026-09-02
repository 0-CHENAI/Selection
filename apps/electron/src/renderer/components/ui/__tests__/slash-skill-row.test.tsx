import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { setupI18n } from '@craft-agent/shared/i18n'
import type { LoadedSkill } from '../../../../shared/types'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('@/components/ui/skill-avatar', () => ({
  SkillAvatar: ({
    skill,
    bare,
    chromeless,
    fallbackIcon,
  }: {
    skill: LoadedSkill
    bare?: boolean
    chromeless?: boolean
    fallbackIcon?: { displayName?: string; name?: string }
  }) => (
    <span
      data-skill-icon={skill.slug}
      data-bare={bare ? 'true' : undefined}
      data-chromeless={chromeless ? 'true' : undefined}
      data-fallback={fallbackIcon?.displayName || fallbackIcon?.name}
    />
  ),
}))

const src = readFileSync(join(__dirname, '../slash-command-menu.tsx'), 'utf8')
const testI18n = setupI18n()

let InlineSlashCommand: typeof import('../slash-command-menu').InlineSlashCommand

beforeAll(async () => {
  ;({ InlineSlashCommand } = await import('../slash-command-menu'))
})

function skill(slug: string, description: string): LoadedSkill {
  return {
    slug,
    metadata: { name: slug, description },
    content: '',
    path: `/skills/${slug}`,
    source: 'workspace',
  }
}

describe('slash skill rows (#210)', () => {
  it('uses a two-column title/description layout and a chromeless Sparkles fallback', () => {
    expect(src).toContain('grid grid-cols-2')
    expect(src).toContain('block min-w-0 truncate')
    expect(src).toContain('fallbackIcon={Sparkles}')
    expect(src).toContain('bare')
    expect(src).toContain('chromeless')
    expect(src).toContain('maxWidth: 400')
    expect(src).not.toMatch(/isSkill\(item\)[\s\S]{0,400}Zap/)
  })

  it('shows title and truncated description so nearby skill names stay distinguishable', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={testI18n}>
        <InlineSlashCommand
          open
          onOpenChange={() => {}}
          sections={[{
            id: 'skills',
            label: 'Skills',
            items: [
              {
                id: 'gsap-core',
                type: 'skill',
                label: 'gsap-core',
                description: 'Core GSAP tweens and timelines',
                skill: skill('gsap-core', 'Core GSAP tweens and timelines'),
              },
              {
                id: 'gsap-performance',
                type: 'skill',
                label: 'gsap-performance',
                description: 'Keep GSAP animations at 60fps',
                skill: skill('gsap-performance', 'Keep GSAP animations at 60fps'),
              },
              {
                id: 'no-desc',
                type: 'skill',
                label: 'plain-skill',
                description: '',
                skill: skill('plain-skill', ''),
              },
            ],
          }]}
          onSelectCommand={() => {}}
          onSelectFolder={() => {}}
          onSelectSkill={() => {}}
          position={{ x: 0, y: 100 }}
        />
      </I18nextProvider>,
    )

    expect(html).toContain('gsap-core')
    expect(html).toContain('Core GSAP tweens and timelines')
    expect(html).toContain('gsap-performance')
    expect(html).toContain('Keep GSAP animations at 60fps')
    expect(html).toContain('title="Core GSAP tweens and timelines"')
    expect(html).toContain('grid-cols-2')
    expect(html).toContain('data-bare="true"')
    expect(html).toContain('data-chromeless="true"')
    expect(html).toContain('data-fallback="Sparkles"')
    expect(html).toContain('plain-skill')
    expect(html).not.toContain('title=""')
    const plainStart = html.indexOf('plain-skill')
    const plainRow = html.slice(html.lastIndexOf('<div', plainStart), html.indexOf('</div></div>', plainStart) + 12)
    expect(plainRow).not.toContain('grid-cols-2')
    expect(html).toContain('max-width:400px')
  })
})
