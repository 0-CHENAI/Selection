import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toSkillCatalogEntries } from '../catalog.ts';
import { filterUserFacingSkills, invalidateSkillsCache, loadAllSkills, loadSkillBySlug, resolveBundledSkillMdPath } from '../storage.ts';

function workspace(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'ppt-design-discovery-'));
  try {
    invalidateSkillsCache();
    run(root);
  } finally {
    invalidateSkillsCache();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('bundled PPT design skill discovery', () => {
  it('exposes one callable design entry, not private layout/style subskills', () => workspace(root => {
    const all = loadAllSkills(root);
    const design = loadSkillBySlug(root, 'ppt-design');
    expect(design?.source).toBe('bundled');
    const entries = toSkillCatalogEntries(all);
    expect(entries.filter(entry => entry.slug === 'ppt-design').map(entry => entry.skillMdPath))
      .toEqual([resolveBundledSkillMdPath('ppt-design')!]);
    expect(all.filter(item => item.path.startsWith(`${design!.path}/`))).toEqual([]);
    expect(filterUserFacingSkills(all).some(item => item.slug === 'ppt-design')).toBe(false);
    expect(entries.some(entry => entry.slug === 'officecli-pptx' || entry.slug === 'morph-ppt')).toBe(false);
  }));

  it('lets a workspace replace the design skill without replacing the OfficeCLI engine router', () => workspace(root => {
    const dir = join(root, 'skills', 'ppt-design');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: Local deck design\ndescription: Workspace deck rules\n---\n\nLocal design.\n');
    const all = loadAllSkills(root);
    expect(loadSkillBySlug(root, 'ppt-design')?.source).toBe('workspace');
    expect(toSkillCatalogEntries(all).find(entry => entry.slug === 'ppt-design')?.skillMdPath)
      .toBe(join(dir, 'SKILL.md'));
    expect(toSkillCatalogEntries(all).find(entry => entry.slug === 'officecli')?.skillMdPath)
      .toBe(resolveBundledSkillMdPath('officecli'));
  }));
});
