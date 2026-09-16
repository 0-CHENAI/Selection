import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiAgent } from '../pi-agent.ts';
import * as configStorage from '../../config/storage.ts';

function fixture(code: string) {
  const root = mkdtempSync(join(tmpdir(), 'pi-lifecycle-'));
  const script = join(root, 'child.cjs');
  writeFileSync(script, code);
  const agent = new PiAgent({ provider: 'pi', isHeadless: true,
    workspace: { id: 'test', name: 'test', rootPath: root },
    session: { id: 'test', workingDirectory: root },
    runtime: { paths: { node: 'node', piServer: script } },
  } as any);
  const internal = agent as any;
  internal.getPiAuth = async () => null;
  internal.getApiKey = async () => null;
  return { agent, internal, script, async cleanup() {
    agent.destroy();
    // Windows may retain the child's working directory until process exit.
    for (let attempt = 0; ; attempt++) {
      try { await rm(root, { recursive: true, force: true }); return; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt >= 20) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  } };
}

describe('Pi subprocess lifecycle fault injection', () => {
  it('does not register source tools while the child is still initializing', async () => {
    const f = fixture('');
    const sent: unknown[] = [];
    f.internal.subprocess = {};
    f.internal.send = (command: unknown) => sent.push(command);
    f.internal.config.mcpPool = {
      sync: async () => {},
      getProxyToolDefs: () => [{ name: 'mcp__database__query' }],
    };
    try {
      await f.agent.setSourceServers({}, {}, ['database']);
      expect(sent).toHaveLength(0);
      f.internal.sourceToolRegistrationReady = true;
      await f.agent.setSourceServers({}, {}, ['database']);
      expect(sent).toHaveLength(1);
    } finally { f.internal.subprocess = null; await f.cleanup(); }
  });

  for (const outcome of ['success', 'failure'] as const) {
    it(`discards an old process's delayed tool ${outcome} after replacement`, async () => {
      const f = fixture('');
      const sent: unknown[] = [];
      let resolve!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      f.internal.subprocess = {};
      f.internal.send = (command: unknown) => sent.push(command);
      f.internal.prerequisiteManager.checkPrerequisites = () => ({ allowed: true });
      f.internal.routeToolCall = () => new Promise((res, rej) => { resolve = res; reject = rej; });
      try {
        const pending = f.internal.handleToolExecuteRequest({ requestId: 'same-id', toolName: 'mcp__database__query', args: {} });
        f.internal.subprocess = {};
        if (outcome === 'success') resolve({ content: 'old result', isError: false });
        else reject(new Error('old failure'));
        await pending;
        expect(sent).toHaveLength(0);
        f.internal.routeToolCall = async () => ({ content: 'new result', isError: false });
        await f.internal.handleToolExecuteRequest({ requestId: 'same-id', toolName: 'mcp__database__query', args: {} });
        expect(sent).toEqual([{ type: 'tool_execute_response', requestId: 'same-id', result: { content: 'new result', isError: false } }]);
      } finally { f.internal.subprocess = null; await f.cleanup(); }
    });
  }

  it('defers MCP registration until startup and restores tools after transport failure', async () => {
    const browserSetting = spyOn(configStorage, 'getBrowserToolEnabled').mockReturnValue(false);
    const f = fixture(`
      const send = message => console.log(JSON.stringify(message));
      let sourceRegistered = false;
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (message.type === 'init') send({ type: 'ready' });
        if (message.type === 'set_auto_compaction') send({ type: 'set_auto_compaction_result', id: message.id, enabled: true });
        if (message.type === 'register_tools' && message.tools.some(tool => tool.name === 'mcp__database__query')) sourceRegistered = true;
        if (message.type === 'mini_completion') send({ type: 'mini_completion_result', id: message.id, text: sourceRegistered ? 'tools ready' : 'tools missing' });
        if (message.type === 'shutdown') process.exit(0);
      });
    `);
    let syncs = 0;
    f.internal.config.mcpPool = {
      sync: async () => { syncs++; },
      getProxyToolDefs: () => [{ name: 'mcp__database__query', description: 'Query database', inputSchema: { type: 'object', properties: {} } }],
    };
    try {
      await f.agent.setSourceServers({}, {}, ['database']);
      expect(f.internal.subprocess).toBeNull();
      expect(await f.agent.runMiniCompletion('first')).toBe('tools ready');
      expect(await f.agent.runMiniCompletion('second')).toBe('tools ready');
      f.internal.failSubprocessTransport(f.internal.subprocess, 'stdout closed');
      await f.agent.setSourceServers({}, {}, ['database']);
      expect(await f.agent.runMiniCompletion('recovered')).toBe('tools ready');
      expect(syncs).toBe(2);
    } finally { await f.cleanup(); browserSetting.mockRestore(); }
  });

  it('reports transport loss with a retry action and the original cause', async () => {
    const f = fixture('');
    const events: any[] = [];
    f.internal.eventQueue.enqueue = (event: any) => events.push(event);
    f.internal._isProcessing = true;
    try {
      f.internal.handleSubprocessExit(1, null);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.canRetry).toBe(true);
      expect(events[0].error.actions[0].action).toBe('retry');
      expect(events[0].error.originalError).toContain('code 1');
    } finally { await f.cleanup(); }
  });

  it('rejects startup when the child exits before ready', async () => {
    const f = fixture('process.exit(1)');
    try { await expect(f.internal.ensureSubprocess(2000)).rejects.toThrow('exited'); }
    finally { await f.cleanup(); }
  });
  it('bounds a silent initialization and kills the child', async () => {
    const f = fixture('setInterval(() => {}, 1000)');
    try {
      await expect(f.internal.ensureSubprocess(100)).rejects.toThrow('startup timed out');
      expect(f.internal.subprocess).toBeNull();
    } finally { await f.cleanup(); }
  });
  it.skipIf(process.platform === 'win32')('detects stdout closure even when the process remains alive', async () => {
    // Windows Node stdout handles do not support this POSIX fd-close fixture.
    const f = fixture("require('node:fs').closeSync(1); setInterval(() => {}, 1000)");
    try { await expect(f.internal.ensureSubprocess(2000)).rejects.toThrow('stdout closed'); }
    finally { await f.cleanup(); }
  });
  it('serializes credential preparation and prevents spawning after stop', async () => {
    const f = fixture('setInterval(() => {}, 1000)');
    let release!: () => void;
    let calls = 0;
    f.internal.getPiAuth = async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return null; };
    try {
      const a = f.internal.ensureSubprocess(2000);
      const b = f.internal.ensureSubprocess(2000);
      const results = Promise.allSettled([a, b]);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(calls).toBe(1);
      f.internal.killSubprocess();
      release();
      expect((await results).every(result => result.status === 'rejected')).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(f.internal.subprocess).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('ignores transport failure belonging to a replaced process', async () => {
    const f = fixture('');
    const old = { kill() { throw new Error('must not touch old process'); } };
    const current = { stdin: { writable: true }, kill() {} };
    try {
      f.internal.subprocess = current;
      f.internal.failSubprocessTransport(old, 'late close');
      expect(f.internal.subprocess).toBe(current);
    } finally { f.internal.subprocess = null; await f.cleanup(); }
  });
});

it('a failed async bridge handler terminates only its owning process', async () => {
  const f = fixture('');
  const owner = {};
  const failures: unknown[] = [];
  f.internal.subprocess = owner;
  f.internal.handlePreToolUseRequest = async () => { throw new Error('permission pipeline failed'); };
  f.internal.failSubprocessTransport = (child: unknown, reason: string) => failures.push({ child, reason });
  try {
    f.internal.handleLine(JSON.stringify({ type: 'pre_tool_use_request', requestId: 'r', toolName: 'read', input: {} }));
    f.internal.subprocess = {};
    await Promise.resolve();
    expect(failures).toEqual([{ child: owner, reason: 'bridge request failed' }]);
  } finally { f.internal.subprocess = null; await f.cleanup(); }
});


it('a failed startup can be followed by a successful request without late-exit corruption', async () => {
  // The transport fixture needs no browser and must not read machine-wide defaults.
  const browserSetting = spyOn(configStorage, 'getBrowserToolEnabled').mockReturnValue(false);
  const f = fixture('setInterval(() => {}, 1000)');
  try {
    const startup = f.internal.ensureSubprocess(150);
    const settled = Promise.allSettled([startup]);
    await new Promise(resolve => setTimeout(resolve, 50));
    const old = f.internal.subprocess;
    await settled;
    writeFileSync(f.script, `
      const send = message => console.log(JSON.stringify(message));
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (message.type === 'init') send({ type: 'ready' });
        if (message.type === 'set_auto_compaction') send({ type: 'set_auto_compaction_result', id: message.id, enabled: true });
        if (message.type === 'mini_completion') send({ type: 'mini_completion_result', id: message.id, text: 'recovered' });
        if (message.type === 'shutdown') process.exit(0);
      });
    `);
    await f.internal.ensureSubprocess(2000);
    const current = f.internal.subprocess;
    old.emit('exit', 1, null);
    expect(f.internal.subprocess).toBe(current);
    expect(await f.agent.runMiniCompletion('test')).toBe('recovered');
  } finally { await f.cleanup(); browserSetting.mockRestore(); }
});
