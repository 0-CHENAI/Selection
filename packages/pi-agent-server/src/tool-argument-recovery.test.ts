import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { validateToolArguments } from '@earendil-works/pi-ai/compat';
import { createRecoveringArgumentPreparer } from './tool-argument-recovery.ts';

describe('Pi pre-validation tool argument recovery', () => {
  it('normalizes Bash aliases before the SDK validates required fields', () => {
    const prepareArguments = createRecoveringArgumentPreparer('Bash');
    const args = prepareArguments({ cmd: 'officecli create report.docx' });
    const tool = {
      name: 'bash',
      description: 'test',
      parameters: Type.Object({ command: Type.String() }, { additionalProperties: false }),
    };
    const validated = validateToolArguments(tool, {
      type: 'toolCall',
      id: 'call-1',
      name: 'bash',
      arguments: args as Record<string, unknown>,
    });
    expect(validated).toEqual({ command: 'officecli create report.docx' });
  });

  it('recovers XML-spilled typed batch input before strict validation', () => {
    const prepareArguments = createRecoveringArgumentPreparer(
      'mcp__session__officecli_batch',
      undefined,
      false,
    );
    const args = prepareArguments({
      _intent: 'Build</intent><file>report.docx</file><operations><item><command>add</command><parent>/body</parent><type>paragraph</type><props><text>Hello</text></props></item></operations>',
    }) as Record<string, unknown>;
    expect(args.file).toBe('report.docx');
    expect(args.operations).toEqual([
      { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'Hello' } },
    ]);
    expect(args._intent).toBeUndefined();

    const tool = {
      name: 'mcp__session__officecli_batch',
      description: 'test',
      parameters: Type.Object({
        file: Type.String(),
        operations: Type.Array(Type.Object({
          command: Type.String(),
          parent: Type.Optional(Type.String()),
          type: Type.Optional(Type.String()),
          props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        }, { additionalProperties: false })),
      }, { additionalProperties: false }),
    };
    expect(() => validateToolArguments(tool, {
      type: 'toolCall',
      id: 'call-2',
      name: tool.name,
      arguments: args,
    })).not.toThrow();
  });

  it('strips provider metadata after recovering strict Read and Bash inputs', () => {
    const read = createRecoveringArgumentPreparer('Read', undefined, false)({
      _intent: 'Read it</intent><path>docs/a.txt</path>',
      _displayName: 'Read a file',
    }) as Record<string, unknown>;
    const bash = createRecoveringArgumentPreparer('Bash', undefined, false)({
      _intent: 'Run it</intent><command>officecli --version</command>',
      _displayName: 'Check OfficeCLI',
    }) as Record<string, unknown>;

    expect(read).toEqual({ path: 'docs/a.txt' });
    expect(bash).toEqual({ command: 'officecli --version' });

    for (const [name, args, field] of [
      ['read', read, 'path'],
      ['bash', bash, 'command'],
    ] as const) {
      const tool = {
        name,
        description: 'test',
        parameters: Type.Object({ [field]: Type.String() }, { additionalProperties: false }),
      };
      expect(() => validateToolArguments(tool, {
        type: 'toolCall',
        id: `call-${name}`,
        name,
        arguments: args,
      })).not.toThrow();
    }
  });

  it('preserves and composes an upstream preparer', () => {
    const prepareArguments = createRecoveringArgumentPreparer('Read', args => ({
      ...(args as Record<string, unknown>),
      offset: 1,
    }));
    expect(prepareArguments({ file_path: 'a.txt' })).toEqual({ path: 'a.txt', offset: 1 });
  });
});
