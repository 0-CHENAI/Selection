import { describe, it, expect } from 'bun:test'
import { migrateDefaultLabelsToChinese, getDefaultLabelConfig } from '../storage.ts'
import type { WorkspaceLabelConfig } from '../types.ts'

describe('migrateDefaultLabelsToChinese', () => {
  it('renames English seed labels to Chinese and removes Development/Project', () => {
    const config: WorkspaceLabelConfig = {
      version: 1,
      labels: [
        {
          id: 'development',
          name: 'Development',
          children: [
            { id: 'code', name: 'Code' },
            { id: 'bug', name: 'Bug' },
            { id: 'automation', name: 'Automation' },
          ],
        },
        {
          id: 'content',
          name: 'Content',
          children: [
            { id: 'writing', name: 'Writing' },
            { id: 'research', name: 'Research' },
            { id: 'design', name: 'Design' },
          ],
        },
        { id: 'priority', name: 'Priority', valueType: 'number' },
        { id: 'project', name: 'Project', valueType: 'string' },
        { id: 'github-actions-monitor', name: 'GitHub Actions Monitor' },
        { id: 'custom-label', name: 'My Custom' },
      ],
    }

    const changed = migrateDefaultLabelsToChinese(config)
    expect(changed).toBe(true)
    expect(config.labels.map(l => l.id)).toEqual(['content', 'priority', 'custom-label'])
    expect(config.labels[0]!.name).toBe('内容')
    expect(config.labels[0]!.children!.map(c => c.name)).toEqual(['写作', '研究', '设计'])
    expect(config.labels[1]!.name).toBe('优先级')
    expect(config.labels[2]!.name).toBe('My Custom')
  })

  it('default config is already Chinese', () => {
    const defaults = getDefaultLabelConfig()
    expect(defaults.labels.map(l => l.name)).toEqual(['内容', '优先级'])
  })
})
