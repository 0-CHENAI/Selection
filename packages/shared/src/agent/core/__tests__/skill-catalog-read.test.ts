import { describe, expect, it } from 'bun:test';
import { PrerequisiteManager } from '../prerequisite-manager.ts';

describe('catalog SKILL.md source activation', () => {
  it('resolves Read and cat of a catalog SKILL.md only', () => {
    const manager = new PrerequisiteManager({ workspaceRootPath: '/ws' });
    manager.setCatalogSkills([
      {
        slug: 'vision',
        skillMdPath: '/ws/skills/vision/SKILL.md',
        requiredSources: ['qwen-mm'],
      },
    ]);

    expect(manager.findCatalogSkillForTool('Read', {
      file_path: '/ws/skills/vision/SKILL.md',
    })?.slug).toBe('vision');
    expect(manager.findCatalogSkillForTool('Bash', {
      command: 'cat "/ws/skills/vision/SKILL.md"',
    })?.requiredSources).toEqual(['qwen-mm']);
    expect(manager.findCatalogSkillForTool('Read', {
      file_path: '/ws/skills/other/SKILL.md',
    })).toBeNull();
    expect(manager.findCatalogSkillForTool('Write', {
      file_path: '/ws/skills/vision/SKILL.md',
    })).toBeNull();
  });
});
