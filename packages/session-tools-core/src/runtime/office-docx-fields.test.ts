import { describe, expect, it } from 'bun:test';
import {
  classifyTocCompile,
  documentHasTocField,
  docxFieldRefreshWarnings,
  nativeTocRefreshAvailable,
  officeQueryMatchCount,
  outlineHeadingSourceCount,
  planTocCompileAction,
  refineDeferredTocFromOutline,
  refreshBackendFromPayload,
} from './office-docx-fields.ts';

describe('documentHasTocField', () => {
  it('accepts a real TOC probe and rejects an empty path stub', () => {
    expect(documentHasTocField({
      matches: 1,
      results: [{ path: '/toc', type: 'toc', text: 'TOC \\o "1-3" \\h \\u' }],
    })).toBe(true);
    expect(documentHasTocField({ type: 'toc', text: 'TOC \\o "1-3"' })).toBe(true);
    expect(documentHasTocField({ path: '/toc', children: [] })).toBe(false);
    expect(documentHasTocField({ matches: 0, results: [] })).toBe(false);
    expect(documentHasTocField({ matches: 1, results: [] })).toBe(false);
    expect(documentHasTocField(null)).toBe(false);
  });
});

describe('officeQueryMatchCount', () => {
  it('reads matches or falls back to results length', () => {
    expect(officeQueryMatchCount({ matches: 2, results: [{}, {}] })).toBe(2);
    expect(officeQueryMatchCount({ results: [{ type: 'paragraph' }] })).toBe(1);
    expect(officeQueryMatchCount({ matches: 0, results: [] })).toBe(0);
    expect(officeQueryMatchCount(null)).toBe(0);
  });
});

describe('outlineHeadingSourceCount', () => {
  it('counts Heading 1–3 and outline levels, but not TOCHeading', () => {
    expect(outlineHeadingSourceCount({
      headings: [
        { text: '目录', style: 'TOCHeading', level: 1 },
        { text: '第一章', style: 'Heading1', level: 1 },
        { text: '1.1', style: 'Heading2', level: 2 },
        { text: '附录', style: 'Appendix', level: 1 },
      ],
    })).toBe(3);
    expect(outlineHeadingSourceCount({
      headings: [{ text: '目录', style: 'TOCHeading', level: 1 }],
    })).toBe(0);
    expect(outlineHeadingSourceCount({ headings: [] })).toBe(0);
  });
});

describe('planTocCompileAction', () => {
  it('refreshes only when Word COM is available', () => {
    expect(planTocCompileAction(false)).toBe('defer_to_word');
    expect(planTocCompileAction(true)).toBe('native_refresh');
  });
});

describe('nativeTocRefreshAvailable', () => {
  it('is only true on Windows when desktop Word is present', () => {
    expect(nativeTocRefreshAvailable('darwin', true)).toBe(false);
    expect(nativeTocRefreshAvailable('win32', false)).toBe(false);
    expect(nativeTocRefreshAvailable('win32', true)).toBe(true);
  });
});

describe('classifyTocCompile', () => {
  it('requires a successful native refresh plus TOC1–3 entries', () => {
    expect(classifyTocCompile({ refreshOk: false, entryMatches: 2 })).toBe('refresh_failed');
    expect(classifyTocCompile({ refreshOk: true, entryMatches: 0 })).toBe('empty');
    expect(classifyTocCompile({ refreshOk: true, entryMatches: 1 })).toBe('compiled');
  });
});

describe('refreshBackendFromPayload', () => {
  it('reads an explicit backend or the officecli refresh sentence', () => {
    expect(refreshBackendFromPayload({ backend: 'word' })).toBe('word');
    expect(refreshBackendFromPayload('Refreshed: report.docx (backend: html)')).toBe('html');
    expect(refreshBackendFromPayload({ value: 'ok' })).toBeUndefined();
  });
});

describe('docxFieldRefreshWarnings', () => {
  it('treats browser skip as a medium deferral, not a Windows-only hard failure', () => {
    expect(docxFieldRefreshWarnings({ status: 'compiled' })).toEqual([]);
    expect(docxFieldRefreshWarnings({ status: 'deferred' })).toEqual([
      expect.objectContaining({ code: 'docx_toc_deferred', severity: 'medium' }),
    ]);
    expect(docxFieldRefreshWarnings({ status: 'empty' })).toEqual([
      expect.objectContaining({ code: 'docx_toc_empty', severity: 'high' }),
    ]);
    expect(JSON.stringify(docxFieldRefreshWarnings({ status: 'refresh_failed' }))).not.toMatch(/Windows only/i);
  });
});

describe('refineDeferredTocFromOutline', () => {
  const deferred = {
    detected: true,
    mutated: true,
    warnings: docxFieldRefreshWarnings({ status: 'deferred' }),
    check: {
      name: 'docx_field_refresh',
      ok: false,
      blocking: false,
      data: {
        detected: true,
        compiled: false,
        status: 'deferred',
        action: 'defer_to_word',
        updateFields: true,
        fallback: true,
        entryMatches: 0,
        headingMatches: 0,
      },
      warnings: docxFieldRefreshWarnings({ status: 'deferred' }),
    },
  };

  it('keeps a deferral when the outline has real heading sources', () => {
    const refined = refineDeferredTocFromOutline(deferred, {
      headings: [
        { text: '目录', style: 'TOCHeading', level: 1 },
        { text: '第一章', style: 'Heading1', level: 1 },
      ],
    });
    expect(refined.check?.data).toMatchObject({ status: 'deferred', headingMatches: 1 });
    expect(refined.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_toc_deferred' }),
    ]));
  });

  it('does not treat TOCHeading as a source', () => {
    const refined = refineDeferredTocFromOutline(deferred, {
      headings: [{ text: '目录', style: 'TOCHeading', level: 1 }],
    });
    expect(refined.check).toMatchObject({
      ok: false,
      data: { status: 'empty', action: 'no_sources', headingMatches: 0 },
    });
    expect(refined.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'docx_toc_empty' }),
    ]));
    expect(refined.warnings.some(warning => warning.code === 'docx_toc_deferred')).toBe(false);
  });
});
