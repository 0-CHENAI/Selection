import { describe, expect, it } from 'bun:test'
import { parseOfficeActivitySummary } from '../office-activity-summary'

describe('Office activity summary', () => {
  it('surfaces backend, artifact, warnings, duration, and current-revision gate', () => {
    const content = `${JSON.stringify({
      ok: true,
      documentPath: '/workspace/季度 报告.docx',
      durationMs: 317,
      backend: 'native',
      warnings: [{ code: 'font_fallback' }],
      artifacts: [{ kind: 'document' }, { kind: 'image' }],
      deliveryReady: true,
    }, null, 2)}\n\n\`\`\`image-preview\n{}\n\`\`\``

    const expected = {
      backend: 'native',
      file: '季度 报告.docx',
      durationMs: 317,
      warningCount: 1,
      deliveryReady: true,
      previewReady: true,
    }
    expect(parseOfficeActivitySummary('office_document_finalize', content)).toEqual(expected)
    expect(parseOfficeActivitySummary('mcp__session__office_document_finalize', content)).toEqual(expected)
  })

  it('ignores non-Office and malformed results', () => {
    expect(parseOfficeActivitySummary('Read', '{}')).toBeNull()
    expect(parseOfficeActivitySummary('office_document_preview', 'not json')).toBeNull()
  })
})
