import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { validateToolArguments } from '@earendil-works/pi-ai/compat';
import { createWriteToolDefinition } from '@earendil-works/pi-coding-agent';
import { getToolDefsAsJsonSchema } from '../../session-tools-core/src/index.ts';
import {
  ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL,
  ISSUE_255_WRITE_UNDERSCORE_CONTENT,
} from '../../shared/src/agent/core/__tests__/fixtures/issue-255-write-preview.ts';
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

  it('cleans spawn_session qualification extras before Pi TypeBox validation', () => {
    const spawn = getToolDefsAsJsonSchema().find(def => def.name === 'spawn_session');
    expect(spawn).toBeDefined();

    const prepareArguments = createRecoveringArgumentPreparer('mcp__session__spawn_session');
    const args = prepareArguments({
      prompt: 'research three models',
      name: '调研 Hy4-preview',
      qualification: {
        finalAggregation: 'merge',
        parallelBenefit: 'parallel',
        tracks: [
          { name: 'a', input: 'a', expectedOutput: 'a', evidence: 'a', toolKinds: ['web_search'] },
          { name: 'b', input: 'b', expectedOutput: 'b', evidence: 'b', toolKinds: ['web_fetch'] },
        ],
        role: 'worker',
        lifecycle: 'managed',
        spawnReason: 'automatic',
      },
    }) as Record<string, unknown>;

    expect(args.role).toBe('worker');
    expect(args.lifecycle).toBe('managed');
    expect(args.spawnReason).toBe('automatic');
    expect(args.qualification).toEqual({
      finalAggregation: 'merge',
      parallelBenefit: 'parallel',
      tracks: [
        { name: 'a', input: 'a', expectedOutput: 'a', evidence: 'a', toolKinds: ['web_search'] },
        { name: 'b', input: 'b', expectedOutput: 'b', evidence: 'b', toolKinds: ['web_fetch'] },
      ],
    });

    expect(() => validateToolArguments(
      { name: 'spawn_session', description: 'test', parameters: spawn!.inputSchema },
      { type: 'toolCall', id: 'call-1', name: 'spawn_session', arguments: args },
    )).not.toThrow();
  });

  it('recovers the captured write({ path, _content }) fixture before strict validation', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const writeTool = createWriteToolDefinition('/tmp', {
      operations: {
        writeFile: async (path, content) => {
          writes.push({ path, content });
        },
        mkdir: async () => {},
      },
    });
    const recoveries: Array<{ from?: string; to?: string }> = [];
    const prepareArguments = createRecoveringArgumentPreparer(
      'Write',
      undefined,
      true,
      events => recoveries.push(...events),
    );
    const args = prepareArguments({ ...ISSUE_255_WRITE_UNDERSCORE_CONTENT }) as Record<string, unknown>;

    expect(args).toEqual({
      path: ISSUE_255_WRITE_UNDERSCORE_CONTENT.path,
      content: ISSUE_255_WRITE_UNDERSCORE_CONTENT._content,
    });
    expect(recoveries).toEqual([{
      kind: 'field_alias',
      toolName: 'write',
      from: '_content',
      to: 'content',
    }]);

    const strictTool = {
      name: 'write',
      description: 'test',
      parameters: Type.Object({
        path: Type.String(),
        content: Type.String(),
      }, { additionalProperties: false }),
    };
    expect(validateToolArguments(strictTool, {
      type: 'toolCall',
      id: 'call-write-strict',
      name: 'write',
      arguments: args,
    })).toEqual(args);
    expect(validateToolArguments(writeTool, {
      type: 'toolCall',
      id: 'call-write-sdk',
      name: 'write',
      arguments: args,
    })).toEqual(args);

    await writeTool.execute('call-write-once', args, undefined, undefined, {} as never);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toBe(ISSUE_255_WRITE_UNDERSCORE_CONTENT._content);
  });

  it('does not recover write conflicts or rewrite markdown-preview into a real tool', () => {
    const writeTool = {
      name: 'write',
      description: 'test',
      parameters: Type.Object({
        path: Type.String(),
        content: Type.String(),
      }, { additionalProperties: false }),
    };
    const prepareWrite = createRecoveringArgumentPreparer('Write');

    const conflict = prepareWrite({
      path: '/tmp/report.md',
      content: 'canonical',
      _content: 'alias',
    }) as Record<string, unknown>;
    expect(conflict).toEqual({
      path: '/tmp/report.md',
      content: 'canonical',
      _content: 'alias',
    });
    expect(() => validateToolArguments(writeTool, {
      type: 'toolCall',
      id: 'call-conflict',
      name: 'write',
      arguments: conflict,
    })).toThrow(/Validation failed for tool "write"/);

    const wrongType = prepareWrite({
      path: '/tmp/report.md',
      _content: 12,
    }) as Record<string, unknown>;
    expect(wrongType).toEqual({ path: '/tmp/report.md', _content: 12 });
    expect(() => validateToolArguments(writeTool, {
      type: 'toolCall',
      id: 'call-wrong-type',
      name: 'write',
      arguments: wrongType,
    })).toThrow(/must have required properties content/);

    const preview = createRecoveringArgumentPreparer(
      ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL.name,
    )({ ...ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL.arguments });
    expect(preview).toEqual({ ...ISSUE_255_MARKDOWN_PREVIEW_TOOL_CALL.arguments });
  });

  it('accepts ORDER-stuffed qualification keys even before recovery', () => {
    const spawn = getToolDefsAsJsonSchema().find(def => def.name === 'spawn_session');
    expect(spawn).toBeDefined();

    expect(() => validateToolArguments(
      { name: 'spawn_session', description: 'test', parameters: spawn!.inputSchema },
      {
        type: 'toolCall',
        id: 'call-raw',
        name: 'spawn_session',
        arguments: {
          prompt: 'research three models',
          qualification: {
            finalAggregation: 'merge',
            parallelBenefit: 'parallel',
            tracks: [
              { name: 'a', input: 'a', expectedOutput: 'a', evidence: 'a', toolKinds: ['web_search'] },
              { name: 'b', input: 'b', expectedOutput: 'b', evidence: 'b', toolKinds: ['web_fetch'] },
            ],
            role: 'worker',
            lifecycle: 'managed',
            spawnReason: 'automatic',
          },
        },
      },
    )).not.toThrow();
  });
});
