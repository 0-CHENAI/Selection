import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
  return { agent, internal, script, cleanup() { agent.destroy(); rmSync(root, { recursive: true, force: true }); } };
}

describe('Pi subprocess lifecycle fault injection', () => {
  it('rejects startup when the child exits before ready', async () => {
    const f = fixture('process.exit(1)');
    try { await expect(f.internal.ensureSubprocess(2000)).rejects.toThrow('exited'); }
    finally { f.cleanup(); }
  });
  it('bounds a silent initialization and kills the child', async () => {
    const f = fixture('setInterval(() => {}, 1000)');
    try {
      await expect(f.internal.ensureSubprocess(100)).rejects.toThrow('startup timed out');
      expect(f.internal.subprocess).toBeNull();
    } finally { f.cleanup(); }
  });
  it('detects stdout closure even when the process remains alive', async () => {
    const f = fixture("require('node:fs').closeSync(1); setInterval(() => {}, 1000)");
    try { await expect(f.internal.ensureSubprocess(2000)).rejects.toThrow('stdout closed'); }
    finally { f.cleanup(); }
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
    } finally { f.cleanup(); }
  });
  it('ignores transport failure belonging to a replaced process', () => {
    const f = fixture('');
    const old = { kill() { throw new Error('must not touch old process'); } };
    const current = { stdin: { writable: true }, kill() {} };
    try {
      f.internal.subprocess = current;
      f.internal.failSubprocessTransport(old, 'late close');
      expect(f.internal.subprocess).toBe(current);
    } finally { f.internal.subprocess = null; f.cleanup(); }
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
  } finally { f.internal.subprocess = null; f.cleanup(); }
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
  } finally { f.cleanup(); browserSetting.mockRestore(); }
});
