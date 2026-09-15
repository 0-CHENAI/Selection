import { expect, it } from 'bun:test';
import { SessionManager, createManagedSession } from './SessionManager.ts';

function fixture() {
  const manager = new SessionManager();
  const managed = createManagedSession({ id: 'lifecycle' }, { id: 'ws', name: 'test', rootPath: '/tmp/lifecycle-test' } as never, { messagesLoaded: true });
  const internal = manager as any;
  internal.sessions.set(managed.id, managed);
  internal.persistSession = () => {};
  internal.flushSession = async () => {};
  return { manager, managed, internal };
}

it('a failed event sink cannot prevent authoritative completion', async () => {
  const { manager, managed, internal } = fixture();
  managed.isProcessing = true;
  manager.setEventSink(() => { throw new Error('client disconnected'); });
  const completed: unknown[] = [];
  manager.onSessionComplete(event => completed.push(event));
  await internal.onProcessingStopped(managed.id, 'complete', managed.processingGeneration);
  expect(managed.isProcessing).toBe(false);
  expect(completed).toHaveLength(1);
});

it('stopping before queued authentication recovery prevents resurrection', async () => {
  const { manager, managed, internal } = fixture();
  managed.isProcessing = true;
  managed.lastSentMessage = 'original';
  let sends = 0;
  internal.sendMessage = async () => { sends++; };
  expect(internal.attemptAuthRetry(managed.id, managed, 'ws')).toBe(true);
  await manager.cancelProcessing(managed.id, true);
  await new Promise(resolve => setImmediate(resolve));
  expect(sends).toBe(0);
  expect(managed.isProcessing).toBe(false);
});

it('cancelled initialization cannot attach a runtime after the next generation starts', async () => {
  const { managed, internal } = fixture();
  let release!: () => void;
  let attached = false;
  internal.initializeAgent = async (_managed: unknown, ensureCurrent: () => void) => {
    await new Promise<void>(resolve => { release = resolve; });
    ensureCurrent();
    attached = true;
    return {};
  };
  const pending = internal.getOrCreateAgent(managed);
  const settled = Promise.allSettled([pending]);
  await Promise.resolve();
  managed.cancelAgentCreation!();
  managed.processingGeneration++;
  expect((await settled)[0]?.status).toBe('rejected');
  release();
  await new Promise(resolve => setImmediate(resolve));
  expect(attached).toBe(false);
  expect(managed.agentCreation).toBeUndefined();
});

it('runtime cleanup cannot indefinitely block stopped state or Conductor completion', async () => {
  const { manager, managed, internal } = fixture();
  managed.isProcessing = true;
  managed.agent = { disposeForRestart: () => new Promise(() => {}) } as never;
  const completed: unknown[] = [];
  manager.onSessionComplete(event => completed.push(event));
  await internal.onProcessingStopped(managed.id, 'interrupted', managed.processingGeneration);
  expect(managed.isProcessing).toBe(false);
  expect(completed).toHaveLength(1);
}, 10_000);

it('authentication recovery revalidates ownership after async runtime disposal', async () => {
  const { managed, internal } = fixture();
  managed.isProcessing = true;
  managed.lastSentMessage = 'original';
  let release!: () => void;
  internal.disposeManagedAgentRuntime = () => new Promise<void>(resolve => { release = resolve; });
  let sends = 0;
  internal.sendMessage = async () => { sends++; };
  internal.attemptAuthRetry(managed.id, managed, 'ws');
  await new Promise(resolve => setImmediate(resolve));
  managed.stopRequested = true;
  managed.processingGeneration++;
  release();
  await new Promise(resolve => setImmediate(resolve));
  expect(sends).toBe(0);
});

it('cancelling initialization does not let deletion race unfinished filesystem preparation', async () => {
  const { manager, managed, internal } = fixture();
  let release!: () => void;
  const work = new Promise<any>(resolve => { release = () => resolve({}); });
  managed.agentInitializations = new Set([work]);
  let disposed = false;
  internal.disposeManagedAgentRuntime = async () => { disposed = true; throw new Error('stop before filesystem deletion'); };
  const deletion = manager.deleteSession(managed.id);
  const settled = Promise.allSettled([deletion]);
  await new Promise(resolve => setImmediate(resolve));
  expect(disposed).toBe(false);
  release();
  expect((await settled)[0]?.status).toBe('rejected');
  expect(disposed).toBe(true);
  expect(managed.deleting).toBe(false);
  expect(managed.stopRequested).toBe(false);
});

it('a late cleanup does not clear a replacement runtime or complete its new generation', async () => {
  const { manager, managed, internal } = fixture();
  managed.isProcessing = true;
  let release!: () => void;
  managed.agent = { disposeForRestart: () => new Promise<void>(resolve => { release = resolve; }) } as never;
  const completed: unknown[] = [];
  manager.onSessionComplete(event => completed.push(event));
  const stopping = internal.onProcessingStopped(managed.id, 'interrupted', managed.processingGeneration);
  await new Promise(resolve => setImmediate(resolve));
  const replacement = {} as never;
  managed.agent = replacement;
  managed.processingGeneration++;
  release();
  await stopping;
  expect(managed.agent).toBe(replacement);
  expect(managed.isProcessing).toBe(true);
  expect(completed).toHaveLength(0);
});
