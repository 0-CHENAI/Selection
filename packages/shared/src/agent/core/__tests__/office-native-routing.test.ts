import { describe, expect, it } from 'bun:test';

import { getNativeOfficeToolRedirect } from '../pre-tool-use.ts';

const OFFICE_FILES = ['Report.DOCX', 'forecast.xlsx', 'roadmap.pptx'];

describe('native Office PreToolUse routing', () => {
  it.each(OFFICE_FILES)('blocks generic content tools for %s', (filePath) => {
    for (const toolName of ['Read', 'Write', 'Edit', 'MultiEdit']) {
      const redirect = getNativeOfficeToolRedirect(toolName, { file_path: filePath });
      expect(redirect?.message).toContain('office_document_inspect');
      expect(redirect?.message).toContain('office_document_edit');
      expect(redirect?.message).toContain('office_document_guide');
      expect(redirect?.message).toContain('office_document_preview');
      expect(redirect?.message).toContain('office_document_finalize');
    }
  });

  it.each(OFFICE_FILES)('blocks legacy Markdown sidecar reads for %s', (filePath) => {
    expect(getNativeOfficeToolRedirect('Read', { file_path: `${filePath}.md` })).not.toBeNull();
  });

  it.each([
    'officecli view Report.DOCX text',
    'docx-tool info Report.docx',
    'xlsx-tool read forecast.xlsx',
    'pptx-tool info roadmap.pptx',
    'markitdown Report.docx',
  ])('blocks shell-based Office content processing: %s', (command) => {
    expect(getNativeOfficeToolRedirect('Bash', { command })).not.toBeNull();
  });

  it.each([
    'officecli status',
    'officecli install',
    './officecli-mac-arm64 --version',
    'officecli-linux-x64 update',
    '"$CRAFT_OFFICECLI" help all --json',
  ])('blocks direct OfficeCLI even when no document path appears: %s', (command) => {
    expect(getNativeOfficeToolRedirect('Bash', { command })).not.toBeNull();
  });

  it('allows the documented explicit Markdown fallback marker', () => {
    expect(getNativeOfficeToolRedirect('Bash', {
      command: 'markitdown Report.docx # selection-office-native-fallback',
    })).toBeNull();
  });

  it('does not allow the fallback marker to bypass direct OfficeCLI blocking', () => {
    expect(getNativeOfficeToolRedirect('Bash', {
      command: 'officecli view Report.docx text # selection-office-native-fallback',
    })).not.toBeNull();
  });

  it.each([
    'cp Report.docx polished.docx',
    'mv forecast.xlsx archive/forecast.xlsx',
    'Copy-Item roadmap.pptx -Destination roadmap-copy.pptx',
  ])('allows ordinary Office filesystem operations: %s', (command) => {
    expect(getNativeOfficeToolRedirect('Bash', { command })).toBeNull();
  });

  it.each([
    'office_document_inspect',
    'office_document_edit',
    'office_document_guide',
    'office_document_preview',
    'office_document_finalize',
    'mcp__session__office_document_inspect',
    'mcp__session__office_document_edit',
    'mcp__session__office_document_guide',
    'mcp__session__office_document_preview',
    'mcp__session__office_document_finalize',
  ])('allows native Office tool %s', (toolName) => {
    expect(getNativeOfficeToolRedirect(toolName, {
      command: 'view',
      arguments: ['Report.docx', 'text'],
    })).toBeNull();
  });

  it('does not affect non-Office files', () => {
    expect(getNativeOfficeToolRedirect('Read', { file_path: 'notes.md' })).toBeNull();
    expect(getNativeOfficeToolRedirect('Bash', { command: 'markitdown notes.pdf' })).toBeNull();
  });
});
