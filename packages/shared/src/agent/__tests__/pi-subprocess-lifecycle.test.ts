import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiAgent } from '../pi-agent.ts';
import * as configStorage from '../../config/storage.ts';
import { resolveOfficecliBinary } from '../../utils/officecli.ts';

function fixture(code: string) {
  // Node reports physical cwd; macOS tmpdir() commonly uses the /var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-lifecycle-')));
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
  return { agent, internal, script, root, async cleanup() {
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
  it('recreates the tool subprocess in the new directory without losing transcript identity', async () => {
    const browserSetting = spyOn(configStorage, 'getBrowserToolEnabled').mockReturnValue(false);
    const f = fixture(`
      let init;
      const send = message => console.log(JSON.stringify(message));
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (message.type === 'init') { init = message; send({ type: 'ready', sessionId: 'kept-transcript' }); }
        if (message.type === 'set_auto_compaction') send({ type: 'set_auto_compaction_result', id: message.id, enabled: true });
        if (message.type === 'mini_completion') send({ type: 'mini_completion_result', id: message.id,
          text: JSON.stringify({ cwd: process.cwd(), workingDirectory: init.workingDirectory, resume: init.resumeSdkSessionId }) });
        if (message.type === 'shutdown') process.exit(0);
      });
    `);
    const next = join(f.root, 'session-root');
    mkdirSync(next);
    const initMessages: any[] = [];
    const send = f.internal.send.bind(f.internal);
    f.internal.send = (command: any) => { if (command.type === 'init') initMessages.push(command); send(command); };
    try {
      const first = JSON.parse((await f.agent.runMiniCompletion('cwd'))!);
      expect(first.cwd).toBe(f.root);
      f.internal.config.session.sdkCwd = f.root;
      const originalProcess = f.internal.subprocess;
      f.internal._isProcessing = true;
      f.agent.updateWorkingDirectory(next);
      await f.internal.ensureSubprocess();
      expect(f.internal.subprocess).toBe(originalProcess);
      f.internal._isProcessing = false;
      const second = JSON.parse((await f.agent.runMiniCompletion('cwd'))!);
      expect(second.cwd).toBe(next);
      expect(second.workingDirectory).toBe(next);
      expect(f.agent.getSessionId()).toBe('kept-transcript');
      expect(f.internal.config.session.sdkCwd).toBe(f.root);
      expect(initMessages).toHaveLength(2);
      expect(second.resume).toBe('kept-transcript');
      expect(initMessages[1].resumeSdkSessionId).toBe('kept-transcript');
    } finally { await f.cleanup(); browserSetting.mockRestore(); }
  });

  it.skipIf(!resolveOfficecliBinary({ trustEnvironment: false }))('passes the Office candidate and trusted runtime into its confined subprocess', async () => {
    const f = fixture(`
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (message.type === 'init') console.log(JSON.stringify({ type: 'ready' }));
        if (message.type === 'set_auto_compaction') console.log(JSON.stringify({ type: 'set_auto_compaction_result', id: message.id, enabled: true }));
        if (message.type === 'shutdown') process.exit(0);
      });
    `);
    f.internal.config.isolatedShellDirectory = f.root;
    f.internal.config.isolatedOfficeDocumentPath = join(f.root, 'candidate.docx');
    f.internal.config.denyExternalBrowsers = true;
    f.internal.config.envOverrides = { CRAFT_OFFICECLI: '/untrusted/officecli' };
    const sent: any[] = [];
    const send = f.internal.send.bind(f.internal);
    f.internal.send = (command: unknown) => { sent.push(command); send(command); };
    try {
      await f.internal.ensureSubprocess(2000);
      const init = sent.find(command => command.type === 'init');
      expect(init.isolatedOfficeDocument).toEqual({ path: join(f.root, 'candidate.docx'), binary: resolveOfficecliBinary({ trustEnvironment: false }) });
      expect(init.isolatedShellDirectory).toBe(f.root);
      expect(init.plansFolderPath).toBe(join(f.root, '.qa', 'plans'));
      expect(init.denyExternalBrowsers).toBe(true);
    } finally { await f.cleanup(); }
  });

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


it('preserves tool timeout classification and aborts host-owned session waits', async () => {
  const f = fixture('');
  const events: any[] = [];
  const controller = new AbortController();
  f.internal.eventQueue.enqueue = (event: any) => events.push(event);
  f.internal.sessionToolControllers.add(controller);
  try {
    f.internal.handleLine(JSON.stringify({ type: 'error', code: 'tool_wait_timeout', message: '工具回包超时' }));
    expect(controller.signal.aborted).toBe(true);
    expect(events).toContainEqual({ type: 'error', code: 'tool_wait_timeout', message: '工具回包超时' });
  } finally { await f.cleanup(); }
});
