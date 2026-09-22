import { describe, expect, it } from 'bun:test';
import { PrerequisiteManager } from '../prerequisite-manager.ts';

describe('catalog SKILL.md source activation', () => {
  it('does not treat path mentions, partial reads, or redirected output as a skill read', () => {
    const manager = new PrerequisiteManager({ workspaceRootPath: '/ws' });
    const path = '/ws/my skills/writing/SKILL.md';
    manager.registerSkillPrerequisites([path]);
    for (const command of [
      `echo "${path}"`, `ls "${path}"`, `head "${path}"`,
      `cat "${path}" > /tmp/out`, `cat "${path}" | head`,
      `false; cat "${path}"`, `cat "${path}" && echo done`,
    ]) {
      expect(manager.isPendingSkillReadCommand({ command })).toBe(false);
      manager.trackSuccessfulBashSkillRead({ command });
      expect(manager.hasRead(path)).toBe(false);
    }
    const input = { command: `cat -- "${path}"` };
    expect(manager.isPendingSkillReadCommand(input)).toBe(true);
    expect(manager.hasRead(path)).toBe(false);
    manager.trackSuccessfulBashSkillRead(input);
    expect(manager.hasRead(path)).toBe(true);
  });
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
