import { describe, expect, it } from 'bun:test';
import {
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
});
