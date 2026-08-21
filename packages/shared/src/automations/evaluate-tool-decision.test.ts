import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomationSystem } from './automation-system.ts';
import { AUTOMATIONS_CONFIG_FILE } from './constants.ts';

describe('evaluateToolDecision', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tool-decision-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeConfig(automations: Record<string, unknown>): AutomationSystem {
    writeFileSync(join(tempDir, AUTOMATIONS_CONFIG_FILE), JSON.stringify({ automations }));
    return new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
    });
  }

  it('returns the first matching block', async () => {
    const system = writeConfig({
      PreToolUse: [
        {
          id: 'mod01',
          matcher: '^Bash$',
          actions: [{ type: 'decision', decision: 'modify', updatedInput: { command: 'echo safe' } }],
        },
        {
          id: 'blk01',
          matcher: '^Bash$',
          actions: [{ type: 'decision', decision: 'block', reason: 'no bash' }],
        },
      ],
    });

    const result = system.evaluateToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    expect(result?.decision).toBe('block');
    expect(result?.matcherId).toBe('blk01');
    expect(result?.reason).toBe('no bash');
    await system.dispose();
  });

  it('returns the first matching modify when no block hits', async () => {
    const system = writeConfig({
      PreToolUse: [
        {
          id: 'mod01',
          matcher: '^Bash$',
          actions: [{ type: 'decision', decision: 'modify', updatedInput: { command: 'echo $CRAFT_TOOL_NAME' } }],
        },
      ],
    });

    const result = system.evaluateToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });

    expect(result?.decision).toBe('modify');
    expect(result?.updatedInput?.command).toBe('echo Bash');
    await system.dispose();
  });

  it('matches tool_input.command contains', async () => {
    const system = writeConfig({
      PreToolUse: [
        {
          id: 'rm01',
          matcher: '^Bash$',
          conditions: [{ condition: 'state', field: 'tool_input.command', contains: 'rm -rf' }],
          actions: [{ type: 'decision', decision: 'block', reason: 'rm -rf' }],
        },
      ],
    });

    expect(system.evaluateToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp' },
    })?.decision).toBe('block');

    expect(system.evaluateToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls /tmp' },
    })).toBeNull();
    await system.dispose();
  });

  it('skips disabled matchers and ignores non-PreToolUse', async () => {
    const system = writeConfig({
      PreToolUse: [
        {
          id: 'off01',
          enabled: false,
          matcher: '^Bash$',
          actions: [{ type: 'decision', decision: 'block' }],
        },
      ],
    });

    expect(system.evaluateToolDecision({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    })).toBeNull();
    expect(system.evaluateToolDecision({
      hook_event_name: 'Stop',
      tool_name: 'Bash',
    })).toBeNull();
    await system.dispose();
  });

  it('matchAgentEvent lists hits without executing actions', async () => {
    const system = writeConfig({
      PreToolUse: [
        { id: 'hit01', matcher: '^Bash$', actions: [{ type: 'prompt', prompt: 'review' }] },
        { id: 'miss01', matcher: '^Read$', actions: [{ type: 'prompt', prompt: 'read' }] },
      ],
    });

    const hits = system.matchAgentEvent('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    });
    expect(hits.map(h => h.matcherId)).toEqual(['hit01']);
    await system.dispose();
  });
});
