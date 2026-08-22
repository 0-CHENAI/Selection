import { describe, expect, it } from 'bun:test';
import {
  OFFICE_DOCUMENT_EDIT_DESCRIPTION,
  OFFICE_DOCUMENT_FINALIZE_DESCRIPTION,
  OFFICE_DOCUMENT_GUIDE_DESCRIPTION,
  OFFICE_DOCUMENT_INSPECT_DESCRIPTION,
  OFFICE_DOCUMENT_PREVIEW_DESCRIPTION,
  OFFICE_MAX_BATCH_FILE_BYTES,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
  OFFICE_WORKFLOW_PROMPT,
} from './office-workflow.ts';

describe('Office workflow contract', () => {
  it('publishes the one-engine, five-tool workflow without the old inspect budget', () => {
    for (const tool of [
      'office_document_inspect',
      'office_document_edit',
      'office_document_guide',
      'office_document_preview',
      'office_document_finalize',
    ]) {
      expect(OFFICE_WORKFLOW_PROMPT).toContain(tool);
    }
    expect(OFFICE_WORKFLOW_PROMPT).toContain('OfficeCLI is the only Office execution engine');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('argv');
    expect(OFFICE_WORKFLOW_PROMPT).toContain("argv: ['help', format, element]");
    expect(OFFICE_WORKFLOW_PROMPT).toContain('must not call status or help');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('Reuse envelope.cwd and envelope.documentPath');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('more than about 10');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('After a batch that is not the standard five-step recipe');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('view issues');
    expect(OFFICE_WORKFLOW_PROMPT).toContain('Never pass open, save, or close');
    expect(OFFICE_WORKFLOW_PROMPT).not.toMatch(/four inspect|最多四次|Windows only/i);
  });

  it('documents native argv, structured batch, hidden guides, explicit preview, and machine gates', () => {
    expect(OFFICE_DOCUMENT_INSPECT_DESCRIPTION).toContain('argv?: string[]');
    expect(OFFICE_DOCUMENT_INSPECT_DESCRIPTION).toContain('loop_prevented');
    expect(OFFICE_DOCUMENT_INSPECT_DESCRIPTION).toContain('recipe.verify');
    expect(OFFICE_DOCUMENT_EDIT_DESCRIPTION).toContain('recipe.clone');
    expect(OFFICE_DOCUMENT_EDIT_DESCRIPTION).toContain(String(OFFICE_MAX_INLINE_BATCH_COMMANDS));
    expect(OFFICE_DOCUMENT_EDIT_DESCRIPTION).toContain(String(OFFICE_MAX_INLINE_BATCH_CHARS));
    expect(OFFICE_DOCUMENT_EDIT_DESCRIPTION).toContain(String(OFFICE_MAX_BATCH_FILE_BYTES));
    expect(OFFICE_DOCUMENT_EDIT_DESCRIPTION).toContain('--best-effort');
    expect(OFFICE_DOCUMENT_GUIDE_DESCRIPTION).toContain('hidden');
    expect(OFFICE_DOCUMENT_PREVIEW_DESCRIPTION).toContain('start is the only action');
    expect(OFFICE_DOCUMENT_FINALIZE_DESCRIPTION).toContain('current artifact revision');
    expect(OFFICE_DOCUMENT_FINALIZE_DESCRIPTION).toContain('not claim Microsoft Office human visual approval');
  });
});
