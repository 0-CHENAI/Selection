import { describe, expect, it } from 'bun:test';
import {
  OFFICE_DOCUMENT_EDIT_DESCRIPTION,
  OFFICE_DOCUMENT_INSPECT_DESCRIPTION,
  OFFICE_MAX_INLINE_ARGUMENTS_CHARS,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
  OFFICE_WORKFLOW_PROMPT,
  isOfficeBudgetResettingEdit,
  isOfficeDocxPath,
  officeInspectFingerprint,
  resolveOfficeDocumentPath,
} from './office-workflow.ts';

describe('Office workflow helpers', () => {
  it('resolves relative document paths against cwd', () => {
    expect(resolveOfficeDocumentPath(['./report.docx', 'outline'], '/project'))
      .toBe('/project/report.docx');
    expect(resolveOfficeDocumentPath(['/tmp/report.docx'], '/project'))
      .toBe('/tmp/report.docx');
    expect(resolveOfficeDocumentPath(['--max-lines', '80'])).toBeUndefined();
    expect(resolveOfficeDocumentPath([])).toBeUndefined();
  });

  it('treats relative and cwd-absolute paths as the same inspect fingerprint', () => {
    expect(officeInspectFingerprint('view', ['report.docx', 'outline'], '/project'))
      .toBe(officeInspectFingerprint('view', ['/project/report.docx', 'outline'], '/project'));
  });

  it('resets inspect budget only after content edits, not refresh', () => {
    expect(isOfficeBudgetResettingEdit('batch')).toBe(true);
    expect(isOfficeBudgetResettingEdit('add')).toBe(true);
    expect(isOfficeBudgetResettingEdit('refresh')).toBe(false);
    expect(isOfficeDocxPath('report.DOCX')).toBe(true);
    expect(isOfficeDocxPath('data.xlsx')).toBe(false);
  });

  it('keeps generate payload rules on edit/system copy and inspect-only rules on inspect', () => {
    expect(OFFICE_WORKFLOW_PROMPT).toContain('batchCommandsFile');
    expect(OFFICE_WORKFLOW_PROMPT).toContain(String(OFFICE_MAX_INLINE_BATCH_COMMANDS));
    expect(OFFICE_WORKFLOW_PROMPT).toContain(String(OFFICE_MAX_INLINE_BATCH_CHARS));
    expect(OFFICE_WORKFLOW_PROMPT).toContain('multiple in-limit batches');
    expect(OFFICE_DOCUMENT_EDIT_DESCRIPTION).toContain('batchCommandsFile');
    expect(OFFICE_DOCUMENT_EDIT_DESCRIPTION).toContain(String(OFFICE_MAX_INLINE_BATCH_COMMANDS));
    expect(OFFICE_DOCUMENT_INSPECT_DESCRIPTION).toContain('view outline');
    expect(OFFICE_DOCUMENT_INSPECT_DESCRIPTION).toContain('at most one validate');
    expect(OFFICE_DOCUMENT_INSPECT_DESCRIPTION).not.toContain('batchCommandsFile');
    expect(OFFICE_DOCUMENT_INSPECT_DESCRIPTION).not.toContain('Generate (large)');
    expect(OFFICE_MAX_INLINE_ARGUMENTS_CHARS).toBe(8_000);
  });
});
