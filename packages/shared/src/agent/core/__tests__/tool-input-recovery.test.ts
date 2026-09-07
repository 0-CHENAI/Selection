import { beforeEach, describe, expect, it } from 'bun:test';
import {
  classifyPreviewFenceToolName,
  getToolCompatCounts,
  noteAssistantPreviewFenceToolCalls,
  recoverKnownToolInput,
  recoverKnownToolInputFromIntent,
  resetToolCompatCounts,
  toolCompatMetricKey,
} from '../tool-input-recovery.ts';
import {
  ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL,
  ISSUE_255_WRITE_UNDERSCORE_CONTENT,
} from './fixtures/issue-255-write-preview.ts';

describe('recoverKnownToolInputFromIntent', () => {
  it('recovers missing Read and Bash arguments without overwriting valid input', () => {
    expect(recoverKnownToolInputFromIntent('Read', {
      _intent: 'Read the file</intent><path>docs/a &amp; b.txt</path>',
    })).toEqual({ _intent: 'Read the file', path: 'docs/a & b.txt' });
    expect(recoverKnownToolInputFromIntent('Bash', {
      command: 'trusted existing command',
      _intent: 'Run it</intent><command>ignored</command><timeout>15000</timeout>',
    })).toEqual({ command: 'trusted existing command', _intent: 'Run it', timeout: 15000 });
  });

  it('normalizes common small-model aliases with or without XML-style intent spillover', () => {
    expect(recoverKnownToolInputFromIntent('Read', { file_path: 'docs/a.txt' }))
      .toEqual({ path: 'docs/a.txt' });
    expect(recoverKnownToolInputFromIntent('Read', {
      _intent: 'Read it</intent><file_path>docs/b.txt</file_path>',
    })).toEqual({ _intent: 'Read it', path: 'docs/b.txt' });
    expect(recoverKnownToolInputFromIntent('Bash', { cmd: 'officecli create report.docx' }))
      .toEqual({ command: 'officecli create report.docx' });
  });

  it('does not recover unknown tools, unknown fields, malformed or oversized markup', () => {
    expect(recoverKnownToolInputFromIntent('unknown', {
      _intent: 'x</intent><command>bad</command>',
    })).toEqual({ _intent: 'x</intent><command>bad</command>' });
    expect(recoverKnownToolInputFromIntent('Read', {
      _intent: 'x</intent><command>bad</command>',
    })).toEqual({ _intent: 'x' });
    expect(recoverKnownToolInputFromIntent('Read', {
      _intent: 'x</intent><path>unterminated',
    })).toEqual({ _intent: 'x</intent><path>unterminated' });
    const oversized = `x</intent><path>${'a'.repeat(256 * 1024)}</path>`;
    expect(recoverKnownToolInputFromIntent('Read', { _intent: oversized })).toEqual({ _intent: oversized });
  });

  it('maps write._content to content only when the canonical field is missing and the alias is a string', () => {
    expect(recoverKnownToolInputFromIntent('Write', { ...ISSUE_255_WRITE_UNDERSCORE_CONTENT }))
      .toEqual({
        path: ISSUE_255_WRITE_UNDERSCORE_CONTENT.path,
        content: ISSUE_255_WRITE_UNDERSCORE_CONTENT._content,
      });
    expect(recoverKnownToolInputFromIntent('write', {
      path: '/tmp/report.md',
      _content: '# report',
    })).toEqual({ path: '/tmp/report.md', content: '# report' });
  });

  it('does not swallow write conflicts, wrong alias types, or unknown fields', () => {
    expect(recoverKnownToolInputFromIntent('Write', {
      path: '/tmp/report.md',
      content: 'canonical',
      _content: 'alias',
    })).toEqual({
      path: '/tmp/report.md',
      content: 'canonical',
      _content: 'alias',
    });
    expect(recoverKnownToolInputFromIntent('Write', {
      path: '/tmp/report.md',
      _content: 12,
    })).toEqual({
      path: '/tmp/report.md',
      _content: 12,
    });
    expect(recoverKnownToolInputFromIntent('Write', {
      path: '/tmp/report.md',
      _content: '# report',
      extra: true,
    })).toEqual({
      path: '/tmp/report.md',
      content: '# report',
      extra: true,
    });
  });

  it('recovers write path/content from XML intent spillover without inventing unknown fields', () => {
    expect(recoverKnownToolInputFromIntent('Write', {
      _intent: 'Write it</intent><path>/tmp/a.md</path><content># recovered</content>',
    })).toEqual({ _intent: 'Write it', path: '/tmp/a.md', content: '# recovered' });
    expect(recoverKnownToolInputFromIntent('Write', {
      _intent: 'Write it</intent><path>/tmp/a.md</path><body>ignored</body>',
    })).toEqual({ _intent: 'Write it', path: '/tmp/a.md' });
  });

  it('leaves markdown-preview tool-call arguments untouched', () => {
    expect(recoverKnownToolInputFromIntent(
      ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL.name,
      { ...ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL.arguments },
    )).toEqual({ ...ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL.arguments });
  });
});

describe('tool compatibility telemetry', () => {
  beforeEach(() => {
    resetToolCompatCounts();
  });

  it('reports write alias recovery so provider/model counts stay visible', () => {
    const recovered = recoverKnownToolInput('Write', {
      ...ISSUE_255_WRITE_UNDERSCORE_CONTENT,
    });
    expect(recovered.recoveries).toEqual([{
      kind: 'field_alias',
      toolName: 'write',
      from: '_content',
      to: 'content',
    }]);
  });

  it('classifies preview fences used as tool names without converting them to text', () => {
    expect(classifyPreviewFenceToolName('markdown-preview')).toBe('preview_fence_tool_call');
    expect(classifyPreviewFenceToolName('Write')).toBeUndefined();
    expect(classifyPreviewFenceToolName('bash')).toBeUndefined();

    const noted = noteAssistantPreviewFenceToolCalls(
      [ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL, { type: 'toolCall', name: 'write' }],
      { provider: 'custom', model: 'glm-5.3-flash' },
    );
    expect(noted).toEqual([{
      kind: 'preview_fence_tool_call',
      toolName: 'markdown-preview',
      provider: 'custom',
      model: 'glm-5.3-flash',
    }]);
    expect(getToolCompatCounts()).toEqual({
      [toolCompatMetricKey({
        kind: 'preview_fence_tool_call',
        toolName: 'markdown-preview',
        provider: 'custom',
        model: 'glm-5.3-flash',
      })]: 1,
    });
  });
});
