import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { Zap } from 'lucide-react'

import type { LoadedSkill } from '../../../../shared/types'
import { SkillAvatar } from '../skill-avatar'

function skill(icon?: string): LoadedSkill {
  return {
    slug: 'example-skill',
    metadata: { name: 'Example skill', description: 'Example description', icon },
    content: '',
    path: '/skills/example-skill',
    source: 'workspace',
  }
}

describe('SkillAvatar fallback (#277)', () => {
  it('uses Sparkles when a skill has no custom icon', () => {
    const html = renderToStaticMarkup(<SkillAvatar skill={skill()} size="sm" />)

    expect(html).toContain('lucide-sparkles')
    expect(html).not.toContain('lucide-zap')
    expect(html).toContain('h-4 w-4')
  })

  it('keeps explicit fallback overrides working', () => {
    const html = renderToStaticMarkup(
      <SkillAvatar skill={skill()} size="sm" fallbackIcon={Zap} />,
    )

    expect(html).toContain('lucide-zap')
    expect(html).not.toContain('lucide-sparkles')
  })

  it('renders metadata emoji instead of the default fallback', () => {
    const html = renderToStaticMarkup(<SkillAvatar skill={skill('✨')} size="sm" />)

    expect(html).toContain('✨')
    expect(html).not.toContain('lucide-sparkles')
  })

  it.each([
    ['SVG', 'https://example.com/skill-icon.svg'],
    ['PNG', 'https://example.com/skill-icon.png'],
  ])('keeps a custom %s icon source ahead of the fallback', (_kind, icon) => {
    const html = renderToStaticMarkup(<SkillAvatar skill={skill(icon)} size="sm" />)

    expect(html).toContain(icon)
  })
})

describe('SkillAvatar list and detail call sites (#277)', () => {
  it('keeps the skills list on the shared small SkillAvatar', () => {
    const source = readFileSync(join(__dirname, '../../app-shell/SkillsListPanel.tsx'), 'utf8')

    expect(source).toContain(
      '<SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />',
    )
  })

  it('keeps the skill detail hero on the shared fluid SkillAvatar', () => {
    const source = readFileSync(join(__dirname, '../../../pages/SkillInfoPage.tsx'), 'utf8')

    expect(source).toContain(
      '<SkillAvatar skill={skill} fluid workspaceId={workspaceId} />',
    )
  })
})
