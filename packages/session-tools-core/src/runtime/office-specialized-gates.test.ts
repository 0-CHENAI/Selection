import { describe, expect, it } from 'bun:test';
import {
  collectSpecializedSkillChecks,
  looksLikeAcademicPaper,
  skillContactSheetArgs,
  uniqueCitationMarkers,
} from './office-specialized-gates.ts';

describe('office specialized skill gates', () => {
  it('detects academic citation markers and prefers a contact sheet for multi-page Word', () => {
    expect(uniqueCitationMarkers('See [1] and [2] then [1] again')).toEqual(['1', '2']);
    expect(looksLikeAcademicPaper('Quarterly report body')).toBe(false);
    expect(looksLikeAcademicPaper('See [1] and [2].')).toBe(true);
    expect(skillContactSheetArgs('.docx', {
      paragraphs: 6,
      headings: [
        { text: '一', style: 'Heading1', level: 1 },
        { text: '二', style: 'Heading2', level: 2 },
        { text: '三', style: 'Heading3', level: 3 },
      ],
    })).toEqual({ grid: 'auto' });
    expect(skillContactSheetArgs('.docx', { paragraphs: 2, headings: [] })).toEqual({ page: '1' });
    expect(skillContactSheetArgs('.pptx', { totalSlides: 3 })).toEqual({ grid: 'auto' });
    expect(skillContactSheetArgs('.xlsx', { sheets: [{ name: 'Sheet1' }] })).toEqual({ page: '1' });
  });

  it('runs academic, form, financial, and pitch executable gates from queried data', async () => {
    const academic = await collectSpecializedSkillChecks({
      extension: '.docx',
      text: 'See [1] and [2]. References.',
      outline: { paragraphs: 8, headings: [] },
      loadedGuides: ['academic-paper'],
      query: async selector => selector.includes('hangingIndent')
        ? { ok: true, data: { matches: 2, results: [{}, {}] } }
        : { ok: true, data: { matches: 0, results: [] } },
    });
    expect(academic.find(check => check.name === 'skill_academic_citations')).toMatchObject({ ok: true });

    const form = await collectSpecializedSkillChecks({
      extension: '.docx',
      text: 'Name ______ TBD',
      outline: { paragraphs: 2 },
      loadedGuides: ['word-form'],
      query: async selector => selector === 'sdt'
        ? { ok: true, data: { matches: 1, results: [{ format: { type: 'text', alias: 'Name', tag: 'name' } }] } }
        : { ok: true, data: { matches: 0, results: [] } },
      get: async () => ({ ok: true, data: { format: { protection: 'forms' } } }),
    });
    expect(form.find(check => check.name === 'skill_form_identity')).toMatchObject({ ok: true });
    expect(form.find(check => check.name === 'skill_form_protection')).toMatchObject({ ok: true });
    expect(form.find(check => check.name === 'skill_form_placeholder_leak')).toMatchObject({ ok: false });

    const financial = await collectSpecializedSkillChecks({
      extension: '.xlsx',
      text: 'Balance',
      outline: { sheets: [{ name: 'P&L', formulas: 4 }] },
      loadedGuides: ['financial-model'],
      query: async selector => selector.includes('IMBALANCED')
        ? { ok: true, data: { matches: 1, results: [{}] } }
        : { ok: true, data: { matches: 0, results: [] } },
    });
    expect(financial.find(check => check.name === 'skill_financial_integrity')).toMatchObject({ ok: false });

    const pitch = await collectSpecializedSkillChecks({
      extension: '.pptx',
      text: 'Series A  M ARR',
      outline: { totalSlides: 10 },
      loadedGuides: ['pitch-deck'],
      query: async () => ({ ok: true, data: { matches: 0, results: [] } }),
    });
    expect(pitch.find(check => check.name === 'skill_pitch_strip')).toMatchObject({ ok: false });
    expect(pitch.find(check => check.name === 'skill_pitch_use_of_funds')).toMatchObject({ ok: false });
    expect(pitch.find(check => check.name === 'skill_pitch_prior_company')).toMatchObject({ ok: false });
    expect(pitch.find(check => check.name === 'skill_pitch_tam')).toMatchObject({ ok: false, blocking: false });
  });

  it('runs dashboard quality, workbook, and morph final-check executable gates', async () => {
    const dashboard = await collectSpecializedSkillChecks({
      extension: '.xlsx',
      text: 'Revenue',
      outline: {
        sheets: [
          { name: 'Dashboard', rows: 4, formulas: 3 },
          { name: 'Data', rows: 12, formulas: 0 },
        ],
      },
      loadedGuides: ['data-dashboard'],
      query: async selector => {
        if (selector.includes('has(formula)')) return { ok: true, data: { matches: 3, results: [{}, {}, {}] } };
        if (selector === 'chart') {
          return {
            ok: true,
            data: {
              matches: 1,
              results: [{
                path: '/Dashboard/chart[1]',
                format: { seriesCount: 1, title: 'Revenue', axisMin: 0 },
                children: [{ type: 'series', format: { name: 'Series1' } }],
              }],
            },
          };
        }
        if (selector === 'conditionalformatting') return { ok: true, data: { matches: 0, results: [] } };
        if (selector === 'sheet') {
          return { ok: true, data: { matches: 2, results: [{ path: '/Dashboard', preview: 'Dashboard' }, { path: '/Data', preview: 'Data' }] } };
        }
        return { ok: true, data: { matches: 0, results: [] } };
      },
      get: async path => {
        if (path === '/workbook') {
          return { ok: true, data: { format: { activeTab: 1, 'calc.fullCalcOnLoad': false } } };
        }
        return {
          ok: true,
          data: {
            results: [{
              path,
              format: { seriesCount: 1, title: 'Revenue' },
              children: [{ type: 'series', format: { name: 'Series1' } }],
            }],
          },
        };
      },
    });
    expect(dashboard.find(check => check.name === 'skill_dashboard_kpis')).toMatchObject({ ok: true });
    expect(dashboard.find(check => check.name === 'skill_dashboard_series_names')).toMatchObject({ ok: false });
    expect(dashboard.find(check => check.name === 'skill_dashboard_conditional_format')).toMatchObject({ ok: false });
    expect(dashboard.find(check => check.name === 'skill_dashboard_workbook')).toMatchObject({ ok: false });

    const morph = await collectSpecializedSkillChecks({
      extension: '.pptx',
      text: '!!actor-hero Title',
      outline: { totalSlides: 2 },
      loadedGuides: ['morph-ppt'],
      query: async () => ({ ok: true, data: { matches: 0, results: [] } }),
      get: async () => ({ ok: true, data: { children: [] } }),
    });
    expect(morph.find(check => check.name === 'skill_morph_final_check')).toMatchObject({ ok: false });
  });
});
