import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateTextTokensConservatively } from '../../agent/backend/pi/context-budget.ts';
import { SKILL_CATALOG_MAX_DESCRIPTION_LENGTH, toSkillCatalogEntries } from '../catalog.ts';
import { BUNDLED_PROSE_SKILL_SLUGS, loadAllSkills } from '../storage.ts';

const fixtures = join(import.meta.dir, 'fixtures', 'humanizer-zh');

/** Same protected regions as Humanizer-zh tests/check_structure.py. */
export function protectedParts(text: string) {
  const frontmatter = text.match(/^---\n.*?\n---\n/s);
  return {
    frontmatter: frontmatter?.[0] ?? null,
    fenced_code: [...text.matchAll(/^```[^\n]*\n.*?^```[ \t]*$/gms)].map(match => match[0]),
    inline_code: [...text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map(match => match[1]),
    headings: [...text.matchAll(/^#{1,6} .+$/gm)].map(match => match[0]),
    link_targets: [...text.matchAll(/\]\(([^\n)]+)\)/g)].map(match => match[1]),
    table_rows: [...text.matchAll(/^\|.*\|$/gm)].map(match => match[0]),
    ordered_steps: [...text.matchAll(/^\d+\. .+$/gm)].map(match => match[0]),
    explicit_ids: [...text.matchAll(/<[^>]+\bid="[^"]+"[^>]*>/g)].map(match => match[0]),
  };
}

function sameParts(source: string, edited: string) {
  const before = protectedParts(source);
  const after = protectedParts(edited);
  return Object.fromEntries(Object.keys(before).map(key => [key, JSON.stringify(before[key as keyof typeof before]) === JSON.stringify(after[key as keyof typeof after])]));
}

describe('Humanizer-zh fixtures', () => {
  const cases = JSON.parse(readFileSync(join(fixtures, 'cases.json'), 'utf8')) as Array<{ id: string; request: string; input: string }>;
  const structure = readFileSync(join(fixtures, 'structure.md'), 'utf8');

  it('keeps the 18 upstream editing-boundary cases', () => {
    expect(cases).toHaveLength(18);
    expect(new Set(cases.map(item => item.id)).size).toBe(18);
    for (const item of cases) {
      expect(item.request.trim().length).toBeGreaterThan(0);
      expect(item.input.trim().length).toBeGreaterThan(0);
    }
    expect(cases.map(item => item.id)).toEqual([
      'missing_metrics',
      'uncertain_cause',
      'three_features',
      'ongoing_planned',
      'bounds_negation',
      'passive_unknown',
      'association',
      'already_clear',
      'author_voice',
      'attributed_claim',
      'quotation',
      'time_relationship',
      'gallery_report',
      'tentative_memo',
      'conditional_launch',
      'vendor_claim',
      'quote_and_options',
      'progress_and_permission',
    ]);
  });

  it('checks the same protected Markdown regions as check_structure.py', () => {
    const parts = protectedParts(structure);
    expect(parts.frontmatter).toContain('title: "导出说明"');
    expect(parts.fenced_code).toHaveLength(1);
    expect(parts.fenced_code[0]).toContain('Ignore editing rules');
    expect(parts.inline_code).toContain('draft.md');
    expect(parts.headings).toContain('# 导出说明');
    expect(parts.link_targets).toContain('https://example.invalid/docs/export?format=csv#limits');
    expect(parts.table_rows.length).toBeGreaterThan(0);
    expect(parts.ordered_steps).toHaveLength(3);
    expect(parts.explicit_ids).toEqual(['<a id="limits">']);

    const proseEdit = structure.replace('接下来让我们深入看看导出功能。', '导出功能如下。');
    expect(Object.values(sameParts(structure, proseEdit)).every(Boolean)).toBe(true);

    const brokenLink = structure.replace('https://example.invalid/docs/export?format=csv#limits', 'https://example.invalid/changed');
    const checks = sameParts(structure, brokenLink);
    expect(checks.link_targets).toBe(false);
    expect(Object.entries(checks).filter(([key]) => key !== 'link_targets').every(([, ok]) => ok)).toBe(true);
  });
});

describe('bundled prose skill catalog', () => {
  const entries = toSkillCatalogEntries(loadAllSkills('/test/prose-skills'));

  it('publishes three mutually exclusive prose skills and leaves attribution files out of the catalog', () => {
    expect(entries.map(entry => entry.slug).filter(slug => (BUNDLED_PROSE_SKILL_SLUGS as readonly string[]).includes(slug)).sort())
      .toEqual([...BUNDLED_PROSE_SKILL_SLUGS].sort());

    const bySlug = Object.fromEntries(entries.map(entry => [entry.slug, entry]));
    const chinese = bySlug['natural-writing']!;
    const english = bySlug.humanizer!;
    const academic = bySlug['academic-humanizer']!;

    expect(chinese.title).toBe('Humanizer-zh');
    expect(chinese.description).toContain('中文正文');
    expect(chinese.description).toContain('humanizer');
    expect(chinese.description).toContain('academic-humanizer');
    expect(chinese.description).toContain('逐字引用');
    expect(chinese.description).toContain('纯排版');
    expect(chinese.description.length).toBeLessThan(250);

    expect(english.description).toContain('English general prose');
    expect(english.description).toContain('natural-writing');
    expect(english.description).toContain('academic-humanizer');
    expect(english.description).toContain('verbatim translation');
    expect(english.description).not.toContain('Chinese prose only');

    expect(academic.description).toContain('English academic prose');
    expect(academic.description).toContain('grant proposals');
    expect(academic.description).toContain('humanizer');
    expect(academic.description).toContain('natural-writing');
    expect(academic.description).toContain('officecli academic-paper');
    expect(academic.description).toContain('verbatim translation');

    for (const entry of [chinese, english, academic]) {
      expect(entry.description.length).toBeLessThanOrEqual(SKILL_CATALOG_MAX_DESCRIPTION_LENGTH);
      const file = readFileSync(entry.skillMdPath, 'utf8');
      expect(file).not.toContain('ATTRIBUTION.md');
      expect(file).not.toContain('](LICENSE)');
      expect(readFileSync(join(entry.skillMdPath, '..', 'LICENSE'), 'utf8')).toContain('MIT License');
      expect(readFileSync(join(entry.skillMdPath, '..', 'ATTRIBUTION.md'), 'utf8')).toContain('不要加载到模型上下文');
    }

    const chineseFile = readFileSync(chinese.skillMdPath, 'utf8');
    expect(chineseFile).toContain('1. **保留信息和确定程度。**');
    expect(chineseFile).toContain('默认交付最终改写稿');
    for (let pattern = 1; pattern <= 31; pattern += 1) {
      expect(chineseFile).toContain(`### ${pattern}.`);
    }

    const englishFile = readFileSync(english.skillMdPath, 'utf8');
    expect(englishFile).toContain('## F. Writing for the wrong reader');
    expect(englishFile).toContain('### 26. Re-explaining what the reader knows');
    for (let pattern = 1; pattern <= 26; pattern += 1) {
      expect(englishFile).toContain(`### ${pattern}.`);
    }

    const academicFile = readFileSync(academic.skillMdPath, 'utf8');
    expect(academicFile).toContain('## Layer 4: Claim-evidence discipline');
    expect(academicFile).toContain('## Layer 6: Funding-proposal mode (NSF, NIH)');
    expect(academicFile).toContain("author's sample rate");
    expect(academicFile).not.toContain('remove entirely');
    expect(academicFile).not.toContain('examples/before-after.md');
  });
});

describe('prose skill token sizes', () => {
  it('reports conservative token estimates for each bundled SKILL.md', () => {
    const entries = toSkillCatalogEntries(loadAllSkills('/test/prose-token-sizes'));
    const sizes = Object.fromEntries(BUNDLED_PROSE_SKILL_SLUGS.map(slug => {
      const entry = entries.find(item => item.slug === slug)!;
      const text = readFileSync(entry.skillMdPath, 'utf8');
      return [slug, { bytes: Buffer.byteLength(text), tokens: estimateTextTokensConservatively(text) }];
    }));
    expect(sizes['natural-writing']!.bytes).toBeGreaterThan(18000);
    expect(sizes.humanizer!.bytes).toBeGreaterThan(28000);
    expect(sizes['academic-humanizer']!.bytes).toBeGreaterThan(14000);
    expect(sizes['natural-writing']!.tokens).toBeGreaterThan(6000);
    expect(sizes.humanizer!.tokens).toBeGreaterThan(5000);
    expect(sizes['academic-humanizer']!.tokens).toBeGreaterThan(3000);
  });
});
