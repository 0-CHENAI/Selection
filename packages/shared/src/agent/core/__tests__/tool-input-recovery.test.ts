import { describe, expect, it } from 'bun:test';
import { recoverKnownToolInputFromIntent } from '../tool-input-recovery.ts';

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

  it('recovers a typed OfficeCLI batch while preserving strict value types', () => {
    const recovered = recoverKnownToolInputFromIntent('mcp__session__officecli_batch', {
      _intent: 'Build the document</intent><file>报告.docx</file><operations>' +
        '<item><command>add</command><parent>/body</parent><type>paragraph</type>' +
        '<props><text>正文</text><bold>true</bold><size>10pt</size></props></item>' +
        '<item><command>set</command><path>/body/p[1]</path><props><color>112233</color></props></item>' +
        '</operations>',
    });
    expect(recovered).toEqual({
      _intent: 'Build the document',
      file: '报告.docx',
      operations: [
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: '正文', bold: true, size: '10pt' } },
        { command: 'set', path: '/body/p[1]', props: { color: '112233' } },
      ],
    });
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
});
