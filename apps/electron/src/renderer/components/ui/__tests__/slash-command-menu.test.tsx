import * as React from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { LoadedSkill } from '../../../../shared/types'
import type { SlashSection } from '../slash-command-menu'

// @craft-agent/ui transitively imports pdfjs-dist, whose Vite ?url suffix is not
// understood by bun's test runner. Stub it before loading the slash menu.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let InlineSlashCommand: typeof import('../slash-command-menu')['InlineSlashCommand']

beforeAll(async () => {
  const module = await import('../slash-command-menu')
  InlineSlashCommand = module.InlineSlashCommand
})

function makeSkill(description: string): LoadedSkill {
  return {
    slug: 'gsap-core',
    metadata: {
      name: 'gsap-core',
      description,
    },
    content: '',
    path: '/skills/gsap-core',
    source: 'global',
  }
}

function renderSkillItem(description: string): string {
  const skill = makeSkill(description)
  const sections: SlashSection[] = [{
    id: 'skills',
    label: 'Skills',
    items: [{
      id: skill.slug,
      type: 'skill',
      label: 'GSAP Core',
      description,
      skill,
    }],
  }]

  return renderToStaticMarkup(
    <InlineSlashCommand
      open
      onOpenChange={() => {}}
      sections={sections}
      onSelectCommand={() => {}}
      onSelectFolder={() => {}}
      onSelectSkill={() => {}}
      position={{ x: 20, y: 20 }}
    />,
  )
}

describe('InlineSlashCommand skill rows', () => {
  it('renders title and truncated description on separate lines with a description tooltip', () => {
    const description = 'Build core GSAP animations and timelines'
    const html = renderSkillItem(description)

    expect(html).toContain('grid grid-cols-2')
    expect(html).toContain('col-span-2 block min-w-0 truncate text-[11px]')
    expect(html).toContain('GSAP Core')
    expect(html).toContain(description)
    expect(html).toContain(`title="${description}"`)
  })

  it('uses a bare Sparkles icon and leaves no empty description row', () => {
    const html = renderSkillItem('')

    expect(html).toContain('lucide-sparkles')
    expect(html).not.toContain('lucide-zap')
    expect(html).not.toContain('grid grid-cols-2')
    expect(html).not.toContain('col-span-2 block min-w-0 truncate text-[11px]')
  })
})
