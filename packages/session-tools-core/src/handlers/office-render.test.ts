import { describe, expect, it } from 'bun:test';
import { handleOfficeRender, type OfficeRenderOutcome } from './office-render.ts';
import { SESSION_TOOL_REGISTRY, getToolDefsAsJsonSchema } from '../tool-defs.ts';
import type { SessionToolContext } from '../context.ts';

const outcome: OfficeRenderOutcome = {
  file: '/work/report.docx',
  kind: 'docx',
  renderer: 'officecli-html-electron-capturePage',
  pageCount: 7,
  images: [
    { label: '1', path: '/s/office-render/report-1.png', width: 1161, height: 1641, data: 'AAA=' },
    { label: '7', path: '/s/office-render/report-7.png', width: 1161, height: 1641, data: 'BBB=' },
  ],
  missingFonts: ['Hiragino Sans GB'],
  notRendered: ['page 9 (document has 7)'],
};

function ctx(extra: Partial<SessionToolContext> = {}): SessionToolContext {
  return { sessionId: 's1', ...extra } as unknown as SessionToolContext;
}

describe('office_render', () => {
  it('is a registered, read-only, safe-mode tool with a JSON schema', () => {
    const def = SESSION_TOOL_REGISTRY.get('office_render');
    expect(def?.executionMode).toBe('registry');
    expect(def?.safeMode).toBe('allow');
    expect(def?.readOnly).toBe(true);
    const json = getToolDefsAsJsonSchema().find(tool => tool.name === 'office_render');
    expect(Object.keys((json?.inputSchema as { properties: object }).properties).sort()).toEqual(['pages', 'path', 'range', 'sheet']);
    expect(def?.description).toContain('Never run OCR');
  });

  it('explains when the host cannot render, without suggesting OCR as a substitute', async () => {
    const result = await handleOfficeRender(ctx(), { path: '/work/report.docx' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('desktop app');
    expect(result.content[0].text).toContain('do not substitute OCR');
  });

  it('rejects non-Office files and unknown arguments', async () => {
    const officeRender = async () => outcome;
    expect((await handleOfficeRender(ctx({ officeRender }), { path: '/work/report.pdf' })).isError).toBe(true);
    expect((await handleOfficeRender(ctx({ officeRender }), { path: '/work/a.docx', zoom: 3 })).isError).toBe(true);
  });

  it('returns one text envelope followed by labelled native image blocks', async () => {
    let received: unknown;
    const result = await handleOfficeRender(ctx({
      supportsImages: true,
      officeRender: async request => { received = request; return outcome; },
    }), { path: 'report.docx', pages: '1,last' });
    expect(received).toEqual({ path: 'report.docx', pages: '1,last' });
    expect(result.isError).toBe(false);
    const [envelope, ...rest] = result.content;
    const summary = JSON.parse(envelope.text.split('\n\n')[0]!);
    expect(summary.renderer).toBe('officecli-html-electron-capturePage');
    expect(summary.images[0]).toEqual({ label: '1', path: '/s/office-render/report-1.png', width: 1161, height: 1641 });
    expect(summary.missingFonts).toEqual(['Hiragino Sans GB']);
    expect(envelope.text).toContain('Do not use OCR');
    expect(envelope.text).toContain('page 9');
    expect(rest.map(part => part.type)).toEqual(['text', 'image', 'text', 'image']);
    expect(rest[1]).toEqual({ type: 'image', data: 'AAA=', mimeType: 'image/png' });
    expect((rest[2] as { text: string }).text).toBe('Page 7');
  });

  it('does not attach images to a text-only model and says the visual check did not happen', async () => {
    const result = await handleOfficeRender(ctx({ supportsImages: false, officeRender: async () => outcome }), { path: '/work/report.docx' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain('cannot receive images');
    expect(result.content[0].text).toContain('do not use OCR');
  });

  it('reports host failures as tool errors', async () => {
    const result = await handleOfficeRender(ctx({ officeRender: async () => { throw new Error('找不到文件'); } }), { path: '/x.xlsx', sheet: '经营总览', range: 'A1:P51' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('找不到文件');
  });
});
