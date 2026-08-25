import { describe, expect, it } from 'bun:test';
import {
  collectSkillSlugsForSourcePreEnable,
  extractPathLikeTokens,
  formatSkillSuggestions,
  globToRegExp,
  matchSkillsByGlobs,
} from '../match.ts';
import type { LoadedSkill } from '../types.ts';

function skill(overrides: Partial<LoadedSkill> & { slug: string; globs?: string[]; requiredSources?: string[] }): LoadedSkill {
  return {
    slug: overrides.slug,
    metadata: {
      name: overrides.metadata?.name ?? overrides.slug,
      description: overrides.metadata?.description ?? `${overrides.slug} description`,
      globs: overrides.globs,
      requiredSources: overrides.requiredSources,
    },
    content: '',
    path: overrides.path ?? `/skills/${overrides.slug}`,
    source: overrides.source ?? 'workspace',
  };
}

describe('skill glob matching', () => {
  it('matches **/*.pdf against a message path and an attachment name', () => {
    const pdf = skill({ slug: 'pdf-review', globs: ['**/*.pdf'], requiredSources: ['qwen-mm'] });

    expect(matchSkillsByGlobs([pdf], { message: 'please read /tmp/notes.pdf' }).map(m => m.slug))
      .toEqual(['pdf-review']);
    expect(matchSkillsByGlobs([pdf], {
      message: 'look at this',
      attachments: [{ type: 'pdf', name: 'notes.pdf', mimeType: 'application/pdf' }],
    }).map(m => m.slug)).toEqual(['pdf-review']);
  });

  it('matches image and video MIME types when the filename is missing', () => {
    const vision = skill({ slug: 'vision', globs: ['**/*.{png,jpg,jpeg,mp4}'] });
    expect(matchSkillsByGlobs([vision], {
      message: 'what is this',
      attachments: [{ type: 'image', mimeType: 'image/png' }],
    }).map(m => m.slug)).toEqual(['vision']);
    expect(matchSkillsByGlobs([vision], {
      message: 'watch',
      attachments: [{ type: 'unknown', mimeType: 'video/mp4' }],
    }).map(m => m.slug)).toEqual(['vision']);
  });

  it('does not match when no path-like token or attachment is present', () => {
    const pdf = skill({ slug: 'pdf-review', globs: ['**/*.pdf'] });
    expect(matchSkillsByGlobs([pdf], { message: 'summarize this pdf conceptually' })).toEqual([]);
  });

  it('does not suggest excluded format skills', () => {
    const format = skill({ slug: 'officecli-docx', globs: ['**/*.docx'] });
    expect(matchSkillsByGlobs([format], { message: 'edit report.docx' })).toEqual([]);
  });

  it('formats a soft suggestion without a force-read directive', () => {
    const text = formatSkillSuggestions([
      { slug: 'pdf-review', title: 'PDF Review', skillMdPath: '/skills/pdf-review/SKILL.md', reason: 'glob' },
    ]);
    expect(text).toContain('PDF Review (pdf-review)');
    expect(text).toContain('path: /skills/pdf-review/SKILL.md');
    expect(text).toContain('are not blocked');
    expect(text).not.toContain('Do not take any other action');
  });

  it('includes officecli for pre-enable when an Office file hard-loads the router', () => {
    const officecli = skill({ slug: 'officecli', globs: ['**/*.docx'], requiredSources: ['unused'] });
    const pdf = skill({ slug: 'pdf-review', globs: ['**/*.pdf'], requiredSources: ['qwen-mm'] });
    const slugs = collectSkillSlugsForSourcePreEnable({
      message: 'compare notes.pdf with 巡察报告.docx',
      mentionedSlugs: ['commit'],
      skills: [officecli, pdf, skill({ slug: 'commit', requiredSources: ['github'] })],
    });
    expect(slugs).toContain('commit');
    expect(slugs).toContain('pdf-review');
    expect(slugs).toContain('officecli');
  });

  it('matches a Chinese Office filename against **/*.docx', () => {
    const review = skill({ slug: 'doc-review', globs: ['**/*.docx'] });
    expect(extractPathLikeTokens('请改 巡察报告.docx')).toContain('巡察报告.docx');
    expect(matchSkillsByGlobs([review], { message: '请改 巡察报告.docx' }).map(m => m.slug))
      .toEqual(['doc-review']);
  });

  it('pre-enables officecli from a file hard-load even when the skill has no globs', () => {
    expect(collectSkillSlugsForSourcePreEnable({
      message: '请改 巡察报告.docx',
      skills: [skill({ slug: 'officecli', requiredSources: ['unused'] })],
    })).toEqual(['officecli']);
  });

  it('still returns a glob-matched skill slug for source pre-enable', () => {
    const vision = skill({ slug: 'vision', globs: ['**/*.png'], requiredSources: ['qwen-mm'] });
    expect(collectSkillSlugsForSourcePreEnable({
      message: 'what is in shot.png',
      skills: [vision],
    })).toEqual(['vision']);
  });

  it('extracts path-like tokens and compiles common globs', () => {
    expect(extractPathLikeTokens('see a.docx and /tmp/b.xlsx')).toEqual(['a.docx', '/tmp/b.xlsx']);
    expect(globToRegExp('**/*.PDF').test('dir/Report.pdf')).toBe(true);
    expect(globToRegExp('*.{png,jpg}').test('x.png')).toBe(true);
    expect(globToRegExp('*.{png,jpg}').test('x.gif')).toBe(false);
  });
});
