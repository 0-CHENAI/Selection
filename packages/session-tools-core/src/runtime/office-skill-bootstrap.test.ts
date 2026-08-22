import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractSkillBootstrap,
  forbiddenCommandRecovery,
  guideNameForCreateArgv,
  guideSections,
  resolveLoadSkillGuide,
  rewriteOfficialSkillInvocations,
} from './office-skill-bootstrap.ts';

const skillsRoot = resolve(import.meta.dir, '../../../../apps/electron/resources/officecli/1.0.144/skills');
const wordSkill = readFileSync(resolve(skillsRoot, 'officecli-docx/SKILL.md'), 'utf8');
const pptxSkill = readFileSync(resolve(skillsRoot, 'officecli-pptx/SKILL.md'), 'utf8');
const financialModelSkill = readFileSync(resolve(skillsRoot, 'officecli-financial-model/SKILL.md'), 'utf8');
const morphPptSkill = readFileSync(resolve(skillsRoot, 'morph-ppt/SKILL.md'), 'utf8');
const morphPpt3dSkill = readFileSync(resolve(skillsRoot, 'morph-ppt-3d/SKILL.md'), 'utf8');
const academicPaperSkill = readFileSync(resolve(skillsRoot, 'officecli-academic-paper/SKILL.md'), 'utf8');
const wordFormSkill = readFileSync(resolve(skillsRoot, 'officecli-word-form/SKILL.md'), 'utf8');

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

  it('rewrites skill incremental-get, html visual audit, and generic Delivery Gate shells onto the five tools', () => {
    const word = rewriteOfficialSkillInvocations(wordSkill);
    const pptx = rewriteOfficialSkillInvocations(pptxSkill);
    const academic = rewriteOfficialSkillInvocations(academicPaperSkill);
    const wordBootstrap = extractSkillBootstrap(word, 'word');

    expect(wordBootstrap.content).toContain('office_document_finalize');
    expect(wordBootstrap.content).toContain('Do not get after every add');
    expect(wordBootstrap.content).toContain('at most one outline');
    expect(wordBootstrap.content).not.toMatch(/After each structural op,\s*`get` it back/i);
    expect(wordBootstrap.content).not.toMatch(/officecli\s+view/i);
    expect(wordBootstrap.content).not.toContain('LEAK=$(');
    expect(wordBootstrap.content).not.toMatch(/`view "\$FILE" issues`/i);
    expect(word).not.toContain('Title sequence first');
    const pptxBootstrap = extractSkillBootstrap(pptx, 'pptx');
    expect(pptx).toContain('Title sequence first');
    expect(pptxBootstrap.content).toContain('Delivery Gate');
    expect(pptxBootstrap.content).toContain('office_document_finalize');
    expect(pptx).toContain('Selection resident already owns open/save/close');
    expect(pptx).not.toMatch(/end with `Selection resident already owns open\/save\/close; do not pass them in argv/i);
    expect(pptx).not.toMatch(/After each structural op,\s*`get \/slide\[N\]/i);
    expect(pptx).not.toMatch(/Screenshot each slide in turn/i);
    expect(pptx).toContain('grid: auto');
    expect(academic).toContain('office_document_finalize');
    expect(academic).toContain('citation round-trip and SEQ');
    expect(academic).toContain('Gate 4 — citation round-trip');
    expect(academic).not.toMatch(/officecli\s+view/i);
  });

  it('does not treat fenced # Gate headings as markdown sections', () => {
    const sections = guideSections([
      '# Real Title',
      '',
      '```bash',
      '# Gate 1 — schema',
      'echo ok',
      '```',
      '',
      '  ```bash',
      '# Chart — left 2/3',
      '  ```',
      '',
      '## Next',
    ].join('\n'));

    expect(sections.map(section => section.title)).toEqual(['Real Title', 'Next']);
  });

  it('folds specialized Delivery Gate shells into finalize without truncating at fenced headings', () => {
    const form = extractSkillBootstrap(rewriteOfficialSkillInvocations(wordFormSkill), 'word-form');
    const morph = extractSkillBootstrap(rewriteOfficialSkillInvocations(morphPptSkill), 'morph-ppt');
    const financial = extractSkillBootstrap(rewriteOfficialSkillInvocations(financialModelSkill), 'financial-model');

    expect(form.content).toContain('office_document_finalize');
    expect(form.content).toContain('Call office_document_finalize after every form');
    expect(form.content).not.toContain('VAL_ERRS=');
    expect(form.content).not.toMatch(/```bash\s*$/);
    expect(morph.content).toContain('office_document_finalize');
    expect(morph.content).toContain('refuse to declare done until deliveryReady');
    expect(morph.content).not.toContain('LEAKS=$(');
    expect(morph.content).not.toMatch(/```bash\s*$/);
    expect(financial.content).toContain('office_document_finalize');
    expect(financial.content).not.toMatch(/```bash\s*$/);
  });

  it('maps create argv and forbidden-command recovery onto the five tools', () => {
    expect(guideNameForCreateArgv(['create', 'report.docx'])).toBe('word');
    expect(guideNameForCreateArgv(['create', 'book', '--type', 'xlsx'])).toBe('excel');
    expect(resolveLoadSkillGuide('powerpoint')).toBe('pptx');
    expect(forbiddenCommandRecovery('load_skill')).toContain('office_document_guide');
    expect(forbiddenCommandRecovery('open')).toContain('office_document_inspect');
  });
});
