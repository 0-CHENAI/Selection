import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractSkillBootstrap,
  forbiddenCommandRecovery,
  guideNameForCreateArgv,
  resolveLoadSkillGuide,
  rewriteOfficialSkillInvocations,
} from './office-skill-bootstrap.ts';

const skillsRoot = resolve(import.meta.dir, '../../../../apps/electron/resources/officecli/1.0.144/skills');
const wordSkill = readFileSync(resolve(skillsRoot, 'officecli-docx/SKILL.md'), 'utf8');
const financialModelSkill = readFileSync(resolve(skillsRoot, 'officecli-financial-model/SKILL.md'), 'utf8');
const morphPpt3dSkill = readFileSync(resolve(skillsRoot, 'morph-ppt-3d/SKILL.md'), 'utf8');
const academicPaperSkill = readFileSync(resolve(skillsRoot, 'officecli-academic-paper/SKILL.md'), 'utf8');

describe('office skill bootstrap', () => {
  it('extracts word Requirements, workflow, QA/Delivery Gate, and TOC without display-note noise', () => {
    const bootstrap = extractSkillBootstrap(wordSkill, 'word');

    expect(bootstrap.matched).toEqual(expect.arrayContaining([
      'Requirements for Outputs',
      'Common Workflow',
      'QA (Required)',
      'Table of Contents',
    ]));
    expect(bootstrap.matched.some(title => /display notes/i.test(title))).toBe(false);
    expect(bootstrap.content).toContain('Requirements for Outputs');
    expect(bootstrap.content).toContain('Delivery Gate');
    expect(bootstrap.content).toContain('Table of Contents');
    expect(bootstrap.content.length).toBeLessThan(40_000);
  });

  it('extracts specialized skill floors that do not use the base Delivery Gate title', () => {
    const financial = extractSkillBootstrap(financialModelSkill, 'financial-model');
    const morph3d = extractSkillBootstrap(morphPpt3dSkill, 'morph-ppt-3d');
    const academic = extractSkillBootstrap(academicPaperSkill, 'academic-paper');

    expect(financial.content.length).toBeGreaterThan(0);
    expect(financial.content).toContain('Audit & Delivery Gate');
    expect(financial.content).toContain('Three-zone architecture');
    expect(morph3d.content.length).toBeGreaterThan(0);
    expect(morph3d.content).toContain('3D Model Compatibility Gate');
    expect(morph3d.content).toContain('3D Model Insertion Rules');
    expect(academic.content).toContain('Requirements (academic floor');
    expect(academic.content).toContain('Workflow — 5 verbs');
  });

  it('rewrites load_skill and resident commands instead of deleting the intent', () => {
    const rewritten = rewriteOfficialSkillInvocations([
      'officecli load_skill word',
      'load_skill pptx',
      'officecli open "$FILE"',
      'officecli save report.docx',
    ].join('\n'));

    expect(rewritten).toContain("office_document_guide { guide: 'word' }");
    expect(rewritten).toContain("office_document_guide { guide: 'pptx' }");
    expect(rewritten).toContain('Selection resident already owns open/save/close');
    expect(rewritten).not.toContain('load_skill');
    expect(rewritten).not.toMatch(/officecli\s+open/);
  });

  it('maps create argv and forbidden-command recovery onto the five tools', () => {
    expect(guideNameForCreateArgv(['create', 'report.docx'])).toBe('word');
    expect(guideNameForCreateArgv(['create', 'book', '--type', 'xlsx'])).toBe('excel');
    expect(resolveLoadSkillGuide('powerpoint')).toBe('pptx');
    expect(forbiddenCommandRecovery('load_skill')).toContain('office_document_guide');
    expect(forbiddenCommandRecovery('open')).toContain('office_document_inspect');
  });
});
