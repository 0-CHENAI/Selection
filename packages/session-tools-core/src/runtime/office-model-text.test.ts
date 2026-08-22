import { describe, expect, it } from 'bun:test';
import type { OfficeResultEnvelope } from '../office-types.ts';
import { officeModelFacingText, toOfficeModelFacingPayload } from './office-model-text.ts';

function envelope(overrides: Partial<OfficeResultEnvelope> = {}): OfficeResultEnvelope {
  return {
    ok: true,
    version: '1.0.144',
    schemaCrc: 'deadbeef',
    command: ['view', 'report.docx', 'outline'],
    cwd: '/tmp/project',
    documentPath: '/tmp/project/report.docx',
    durationMs: 42,
    warnings: [],
    cacheHit: false,
    artifacts: [],
    ...overrides,
  };
}

describe('office model-facing text', () => {
  it('omits pinned metadata and pretty-print from the model transcript', () => {
    const text = officeModelFacingText(envelope({
      data: { paragraphs: 2 },
    }));

    expect(text).not.toContain('\n');
    expect(text).not.toContain('1.0.144');
    expect(text).not.toContain('deadbeef');
    expect(text).not.toContain('durationMs');
    expect(JSON.parse(text)).toEqual({
      ok: true,
      command: ['view', 'report.docx', 'outline'],
      documentPath: '/tmp/project/report.docx',
      cwd: '/tmp/project',
      data: { paragraphs: 2 },
    });
  });

  it('keeps only failed finalize checks and compact artifacts', () => {
    const payload = toOfficeModelFacingPayload(envelope({
      deliveryReady: false,
      artifacts: [{
        kind: 'image',
        path: '/tmp/preview.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        page: '1',
      }],
      evidence: {
        file: '/tmp/project/report.docx',
        profile: 'strict',
        artifactRevision: 3,
        generatedAt: '2026-08-22T00:00:00.000Z',
        checks: [
          { name: 'openxml_validate', ok: true, blocking: true },
          {
            name: 'skill_page_field',
            ok: false,
            blocking: true,
            data: { matches: 0 },
            error: {
              code: 'docx_page_field_required',
              category: 'conflict',
              message: 'Add a PAGE field.',
              retriable: true,
              recovery: 'Add --prop field=page.',
            },
          },
        ],
      },
    }));

    expect(payload.evidence).toEqual({
      profile: 'strict',
      artifactRevision: 3,
      failed: [{
        name: 'skill_page_field',
        blocking: true,
        error: {
          code: 'docx_page_field_required',
          category: 'conflict',
          message: 'Add a PAGE field.',
          retriable: true,
          recovery: 'Add --prop field=page.',
        },
      }],
    });
    expect(payload.artifacts).toEqual([{ kind: 'image', path: '/tmp/preview.png', page: '1' }]);
  });

  it('does not repeat the execution contract inside bootstrap content', () => {
    const contract = '## Selection execution contract (immutable)\n- batch first';
    const payload = toOfficeModelFacingPayload(envelope({
      data: {
        executionContract: contract,
        bootstrap: { content: `${contract}\n\nRequirements for Outputs` },
      },
    }));

    expect(payload.data).toEqual({
      executionContract: contract,
      bootstrap: { content: 'Requirements for Outputs' },
    });
  });
});
