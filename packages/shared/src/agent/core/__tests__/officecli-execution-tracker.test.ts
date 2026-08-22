import { describe, expect, it } from 'bun:test';
import { OfficecliExecutionTracker } from '../officecli-execution-tracker.ts';

describe('OfficecliExecutionTracker', () => {
  it('blocks the ninth direct content mutation for one file', () => {
    const tracker = new OfficecliExecutionTracker();
    for (let index = 0; index < 8; index += 1) {
      expect(tracker.inspect('Bash', {
        command: `officecli add report.docx /body --type paragraph --text item-${index}`,
      })).toEqual({ allowed: true });
    }

    const ninth = tracker.inspect('Bash', {
      command: 'officecli set report.docx /body/children/0 --props \'{"text":"x"}\'',
    });
    expect(ninth.allowed).toBe(false);
    expect(ninth.allowed ? undefined : ninth.kind).toBe('direct_mutation_limit');
    expect(tracker.snapshot()).toMatchObject({ directMutations: 8, blockedCalls: 1 });
  });

  it('normalizes relative path aliases before enforcing the per-file limit', () => {
    const tracker = new OfficecliExecutionTracker();
    for (let index = 0; index < 8; index += 1) {
      expect(tracker.inspect('Bash', {
        command: 'officecli add report.docx /body --type paragraph',
      }, undefined, '/tmp/officecli-budget')).toEqual({ allowed: true });
    }
    expect(tracker.inspect('Bash', {
      command: 'officecli add ./report.docx /body --type paragraph',
    }, undefined, '/tmp/officecli-budget')).toMatchObject({
      allowed: false,
      kind: 'direct_mutation_limit',
    });
    expect(tracker.snapshot()).toMatchObject({ directMutations: 8, fileCount: 1 });
  });

  it('accounts for a simple leading cd when identifying the target file', () => {
    const tracker = new OfficecliExecutionTracker();
    for (let index = 0; index < 8; index += 1) {
      expect(tracker.inspect('Bash', {
        command: 'cd subdir-a && officecli add report.docx /body --type paragraph',
      }, undefined, '/tmp/officecli-budget')).toEqual({ allowed: true });
    }
    expect(tracker.inspect('Bash', {
      command: 'cd subdir-b && officecli add report.docx /body --type paragraph',
    }, undefined, '/tmp/officecli-budget')).toEqual({ allowed: true });
    expect(tracker.inspect('Bash', {
      command: 'cd subdir-a && officecli add report.docx /body --type paragraph',
    }, undefined, '/tmp/officecli-budget')).toMatchObject({
      allowed: false,
      kind: 'direct_mutation_limit',
    });
    expect(tracker.snapshot().fileCount).toBe(2);
  });

  it('counts a typed batch once and never as direct mutations', () => {
    const tracker = new OfficecliExecutionTracker();
    const operations = Array.from({ length: 50 }, () => ({ command: 'add' }));
    expect(tracker.inspect('mcp__session__officecli_batch', {
      file: 'report.docx',
      operations,
    })).toEqual({ allowed: true });
    expect(tracker.snapshot()).toMatchObject({
      toolCalls: 1,
      batchCalls: 1,
      batchOperations: 50,
      batchSizes: [50],
      directMutations: 0,
    });
  });

  it('enforces the direct-mutation limit independently for each file', () => {
    const tracker = new OfficecliExecutionTracker();
    for (const file of ['a.docx', 'b.docx']) {
      for (let index = 0; index < 8; index += 1) {
        expect(tracker.inspect('Bash', {
          command: `officecli add "${file}" /body --type paragraph`,
        })).toEqual({ allowed: true });
      }
    }
    expect(tracker.snapshot()).toMatchObject({ directMutations: 16, fileCount: 2 });
    expect(tracker.inspect('Bash', {
      command: 'officecli add "a.docx" /body --type paragraph',
    })).toMatchObject({ allowed: false, kind: 'direct_mutation_limit' });
    expect(tracker.inspect('Bash', {
      command: 'officecli add "b.docx" /body --type paragraph',
    })).toMatchObject({ allowed: false, kind: 'direct_mutation_limit' });
  });

  it('recognizes quoted Windows OfficeCLI executables', () => {
    const tracker = new OfficecliExecutionTracker();
    expect(tracker.inspect('Bash', {
      command: '"C:\\Program Files\\Selection\\officecli.exe" add report.docx /body --type paragraph',
    })).toEqual({ allowed: true });
    expect(tracker.snapshot()).toMatchObject({ toolCalls: 1, directMutations: 1 });
  });

  it('blocks the ninth direct mutation through the Windows CMD wrapper spelling', () => {
    const tracker = new OfficecliExecutionTracker();
    for (let index = 0; index < 8; index += 1) {
      expect(tracker.inspect('Bash', {
        command: 'officecli.cmd add report.docx /body --type paragraph',
      })).toEqual({ allowed: true });
    }
    expect(tracker.inspect('Bash', {
      command: 'officecli.cmd set report.docx /body/children/0 --props "{}"',
    })).toMatchObject({ allowed: false, kind: 'direct_mutation_limit' });
  });

  it('blocks PowerShell stop-parsing and Start-Process mutation loops', () => {
    for (const command of [
      '& $env:CRAFT_OFFICECLI --% add report.docx /body --type paragraph',
      'Start-Process -Wait -FilePath $env:CRAFT_OFFICECLI -ArgumentList "add report.docx /body --type paragraph"',
      'Start-Process $env:CRAFT_OFFICECLI -ArgumentList "add report.docx /body --type paragraph"',
      'Start-Process -ArgumentList "add report.docx /body --type paragraph" -FilePath $env:CRAFT_OFFICECLI',
      'Start-Process -FilePath $env:CRAFT_OFFICECLI -ArgumentList @("add","report.docx","/body") -Wait',
    ]) {
      const tracker = new OfficecliExecutionTracker();
      for (let index = 0; index < 8; index += 1) {
        expect(tracker.inspect('Bash', { command })).toEqual({ allowed: true });
      }
      expect(tracker.inspect('Bash', { command })).toMatchObject({
        allowed: false,
        kind: 'direct_mutation_limit',
      });
    }
  });

  it('does not let the managed binary environment variable bypass mutation budgets', () => {
    const tracker = new OfficecliExecutionTracker();
    expect(tracker.inspect('Bash', {
      command: '"$CRAFT_OFFICECLI" add report.docx /body --type paragraph',
    })).toEqual({ allowed: true });
    expect(tracker.inspect('Bash', {
      command: '${CRAFT_OFFICECLI} batch report.docx --stop-on-error --json',
    })).toEqual({ allowed: true });
    expect(tracker.inspect('Bash', {
      command: 'officecli.cmd add report.docx /body --type paragraph',
    })).toEqual({ allowed: true });
    expect(tracker.inspect('Bash', {
      command: '%CRAFT_OFFICECLI% set report.docx /body/children/0 --props "{}"',
    })).toEqual({ allowed: true });
    expect(tracker.inspect('Bash', {
      command: '& $env:CRAFT_OFFICECLI remove report.docx /body/children/0',
    })).toEqual({ allowed: true });
    expect(tracker.inspect('Bash', {
      command: '& ${env:CRAFT_OFFICECLI} batch report.docx --stop-on-error --json',
    })).toEqual({ allowed: true });
    expect(tracker.snapshot()).toMatchObject({ toolCalls: 6, batchCalls: 2, directMutations: 4 });
  });

  it('forces one replan at 20 total calls without permanently blocking advanced commands', () => {
    const tracker = new OfficecliExecutionTracker();
    for (let index = 0; index < 19; index += 1) {
      expect(tracker.inspect('Bash', { command: 'officecli validate report.docx' })).toEqual({ allowed: true });
    }
    const twentieth = tracker.inspect('Bash', { command: 'officecli view report.docx issues' });
    expect(twentieth.allowed).toBe(false);
    expect(twentieth.allowed ? undefined : twentieth.kind).toBe('replan_required');
    expect(tracker.inspect('Bash', { command: 'officecli render report.docx --format pdf' })).toEqual({ allowed: true });
    expect(tracker.snapshot()).toMatchObject({ attemptedToolCalls: 21, toolCalls: 20 });
  });

  it('allows at most two QA calls in one user task', () => {
    const tracker = new OfficecliExecutionTracker();
    expect(tracker.inspect('officecli_qa', { file: 'report.docx' })).toEqual({ allowed: true });
    expect(tracker.inspect('officecli_qa', { file: 'report.docx' })).toEqual({ allowed: true });
    expect(tracker.inspect('officecli_qa', { file: 'report.docx' })).toMatchObject({
      allowed: false,
      kind: 'qa_limit',
    });
  });

  it('reuses the budget decision for duplicate Pi pre-tool requests', () => {
    const tracker = new OfficecliExecutionTracker();
    const input = { file: 'report.docx', mode: 'balanced' };

    expect(tracker.inspect('mcp__session__officecli_qa', input, 'call-1')).toEqual({ allowed: true });
    expect(tracker.inspect('mcp__session__officecli_qa', input, 'call-1')).toEqual({ allowed: true });
    expect(tracker.snapshot()).toMatchObject({ attemptedToolCalls: 1, toolCalls: 1, qaCalls: 1 });

    expect(tracker.inspect('mcp__session__officecli_qa', input, 'call-2')).toEqual({ allowed: true });
    const blocked = tracker.inspect('mcp__session__officecli_qa', input, 'call-3');
    expect(blocked).toMatchObject({ allowed: false, kind: 'qa_limit' });
    expect(tracker.inspect('mcp__session__officecli_qa', input, 'call-3')).toEqual(blocked);
    expect(tracker.snapshot()).toMatchObject({ attemptedToolCalls: 3, toolCalls: 2, qaCalls: 2, blockedCalls: 1 });
  });

  it('blocks conflicting duplicate tool call IDs', () => {
    const tracker = new OfficecliExecutionTracker();
    expect(tracker.inspect('mcp__session__officecli_qa', {
      file: 'a.docx', mode: 'balanced',
    }, 'call-1')).toEqual({ allowed: true });
    expect(tracker.inspect('mcp__session__officecli_batch', {
      file: 'a.docx', operations: [{ command: 'get', path: '/' }],
    }, 'call-1')).toMatchObject({ allowed: false, kind: 'protocol_conflict' });
    expect(tracker.snapshot()).toMatchObject({ attemptedToolCalls: 1, toolCalls: 1, blockedCalls: 1 });
  });

  it('resets all per-user-turn budgets', () => {
    const tracker = new OfficecliExecutionTracker();
    tracker.inspect('mcp__session__officecli_qa', { file: 'report.docx' });
    tracker.inspect('Bash', { command: 'officecli add report.docx /body --type paragraph' });
    tracker.reset();
    expect(tracker.snapshot()).toEqual({
      attemptedToolCalls: 0,
      toolCalls: 0,
      batchCalls: 0,
      batchOperations: 0,
      batchSizes: [],
      directMutations: 0,
      qaCalls: 0,
      qaModes: {},
      visualStatuses: {},
      blockedCalls: 0,
      replanTriggered: false,
      fileCount: 0,
      executionMs: 0,
      errorTypes: {},
      failedOperationIndexes: [],
    });
  });

  it('records only bounded, content-free execution telemetry', () => {
    const tracker = new OfficecliExecutionTracker();
    tracker.recordExecution(12.6, {
      errorType: 'officecli',
      failedIndex: 3,
      qaMode: 'balanced',
      visualStatus: 'skipped_no_vision',
    });
    tracker.recordExecution(7.2, { errorType: 'officecli', failedIndex: 3 });
    tracker.recordExecution(4, { errorType: '/private/report.docx', failedIndex: 99 });
    expect(tracker.snapshot()).toMatchObject({
      executionMs: 24,
      errorTypes: { officecli: 2 },
      failedOperationIndexes: [3],
      qaModes: { balanced: 1 },
      visualStatuses: { skipped_no_vision: 1 },
    });
  });

  it('restores the same task budget across an internal backend retry', () => {
    const beforeRetry = new OfficecliExecutionTracker();
    for (let index = 0; index < 8; index += 1) {
      beforeRetry.inspect('Bash', {
        command: `officecli add report.docx /body --type paragraph --text item-${index}`,
      });
    }
    beforeRetry.inspect('mcp__session__officecli_qa', { file: 'report.docx' });
    beforeRetry.recordExecution(25, { qaMode: 'balanced', visualStatus: 'skipped_no_vision' });

    const afterRetry = new OfficecliExecutionTracker();
    afterRetry.restore(beforeRetry.checkpoint());

    expect(afterRetry.inspect('Bash', {
      command: 'officecli add report.docx /body --type paragraph --text ninth',
    })).toMatchObject({ allowed: false, kind: 'direct_mutation_limit' });
    expect(afterRetry.snapshot()).toMatchObject({
      directMutations: 8,
      qaCalls: 1,
      qaModes: { balanced: 1 },
      visualStatuses: { skipped_no_vision: 1 },
      executionMs: 25,
      fileCount: 1,
    });
  });
});
