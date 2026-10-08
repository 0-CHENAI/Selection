import { afterAll, expect, test, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '../../transport';
import type { HandlerDeps } from '../handler-deps';

const configRoot = mkdtempSync(join(tmpdir(), 'selection-root-plan-config-'));
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;
process.env.CRAFT_CONFIG_DIR = configRoot;
const config = await import('@craft-agent/shared/config');
expect(config.CONFIG_DIR).toBe(configRoot);
config.ensureConfigDir();
const { taskYamlPath, saveTaskDocument, listRunIds } = await import('@craft-agent/shared/tasks');
const { getSessionFilePath, loadSession } = await import('@craft-agent/shared/sessions');
const { SessionManager } = await import('../../sessions/SessionManager');
const { registerTasksHandlers } = await import('./tasks');
afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
  rmSync(configRoot, { recursive: true, force: true });
});
const yaml = 'schema_version: 3\nid: f7-plan\ntitle: F7\ngoal: 比较 A/B 两年成本与风险，只分析不部署\nnodes:\n  - id: one\n    prompt: Read\n';
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'selection-root-plan-')), workspace = { id: 'qa', slug: 'qa', name: 'QA', rootPath: root, createdAt: 1 };
  const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue(workspace), workspaces = spyOn(config, 'getWorkspaces').mockReturnValue([workspace]);
  const manager = new SessionManager(), internal = manager as any, handlers = new Map<string, (...args: any[]) => Promise<any>>();
  registerTasksHandlers({ handle: (name: string, fn: (...args: any[]) => Promise<any>) => handlers.set(name, fn), push() { } } as unknown as RpcServer, { sessionManager: manager } as unknown as HandlerDeps);
  return { root, workspace, manager, internal, call: (req: unknown) => handlers.get(RPC_CHANNELS.tasks.CREATE)!({}, workspace.id, req), cleanup: async () => { await manager.flushAllSessions(); manager.cleanup(); lookup.mockRestore(); workspaces.mockRestore(); rmSync(root, { recursive: true, force: true }); } };
}
test('F7 explicit plan creation preserves the handover PRO root, model, permission, history and creates no run', async () => {
  const f = await fixture();
  try {
    const source = await f.manager.createSession(f.workspace.id, { workMode: 'NORM', permissionMode: 'safe', model: 'gpt-6-luna', name: 'Source' });
    f.internal.sessions.get(source.id).messages.push({ id: 'goal', role: 'user', content: '比较 A/B 两年成本与风险，只分析不部署。', timestamp: 1 });
    const handover = (await f.manager.handoverSession(source.id, { type: 'create', handoverId: 'f7', targetMode: 'PRO' })).records[0]!, id = handover.targetSessionId!;
    const before = loadSession(f.root, id)!, sourceBytes = readFileSync(getSessionFilePath(f.root, source.id), 'utf8'), created = await f.call({ yaml, rootSessionId: id }), after = loadSession(f.root, id)!;
    expect(created.orchestratorSessionId).toBe(id);
    expect(after.taskSlug).toBe('f7-plan');
    expect(after.messages).toEqual(before.messages);
    expect(after.handover).toEqual(before.handover);
    expect(after.model).toBe(before.model);
    expect(after.permissionMode).toBe('safe');
    expect(after.swarmEnabled).toBe(before.swarmEnabled);
    expect(readFileSync(getSessionFilePath(f.root, source.id), 'utf8')).toBe(sourceBytes);
    expect(f.manager.getSessions(f.workspace.id)).toHaveLength(2);
    expect(listRunIds(f.root, 'f7-plan')).toEqual([]);
    expect((await f.call({ yaml, rootSessionId: id })).orchestratorSessionId).toBe(id);
    await expect(f.call({ yaml: yaml.replace('title: F7', 'title: overwrite'), rootSessionId: id })).rejects.toThrow('already exists');
  }
  finally {
    await f.cleanup();
  }
});
test('F7 explicit creation rejects NORM, foreign, worker, busy and active-child roots before writing', async () => {
  const f = await fixture();
  try {
    const norm = await f.manager.createSession(f.workspace.id, { workMode: 'NORM' }), pro = await f.manager.createSession(f.workspace.id, { workMode: 'PRO' }), worker = await f.manager.createSession(f.workspace.id, { workMode: 'PRO', parentSessionId: pro.id });
    await expect(f.call({ yaml, rootSessionId: norm.id })).rejects.toThrow('NORM');
    await expect(f.call({ yaml, rootSessionId: worker.id })).rejects.toThrow('root coordinator');
    const managed = f.internal.sessions.get(pro.id);
    managed.isProcessing = true;
    await expect(f.call({ yaml, rootSessionId: pro.id })).rejects.toThrow('settle');
    await expect(f.manager.bindExistingSessionToTask(pro.id, 'direct')).rejects.toThrow('settle');
    managed.isProcessing = false;
    f.internal.handoverCapturing.add(pro.id);
    await expect(f.manager.bindExistingSessionToTask(pro.id, 'direct')).rejects.toThrow('settle');
    f.internal.handoverCapturing.delete(pro.id);
    f.internal.sessions.get(worker.id).isProcessing = true;
    await expect(f.call({ yaml, rootSessionId: pro.id })).rejects.toThrow('settle');
    f.internal.sessions.get(worker.id).isProcessing = false;
    await expect(f.call({ yaml, rootSessionId: 'foreign' })).rejects.toThrow('this workspace');
    expect(existsSync(taskYamlPath(f.root, 'f7-plan'))).toBe(false);
  }
  finally {
    await f.cleanup();
  }
});
test('F7 interrupted plan commit recovers only the identical unowned definition and refuses another root', async () => {
  const f = await fixture();
  try {
    const root = await f.manager.createSession(f.workspace.id, { workMode: 'PRO' }), other = await f.manager.createSession(f.workspace.id, { workMode: 'PRO' });
    saveTaskDocument(f.root, yaml, null);
    // The file committed before process exit, while root metadata had not yet committed.
    const created = await f.call({ yaml, rootSessionId: root.id });
    expect(created.orchestratorSessionId).toBe(root.id);
    await expect(f.call({ yaml, rootSessionId: other.id })).rejects.toThrow('already exists');
    expect(listRunIds(f.root, 'f7-plan')).toEqual([]);
  }
  finally {
    await f.cleanup();
  }
});
test('F7 a failed root flush keeps its definition recoverable and never falls back to a fresh root', async () => {
  const f = await fixture();
  try {
    const root = await f.manager.createSession(f.workspace.id, { workMode: 'PRO' }), flush = spyOn(f.manager, 'flushSession').mockRejectedValueOnce(new Error('crash-before-root-flush'));
    await expect(f.call({ yaml, rootSessionId: root.id })).rejects.toThrow('crash-before-root-flush');
    flush.mockRestore();
    expect(existsSync(taskYamlPath(f.root, 'f7-plan'))).toBe(true);
    expect((await f.call({ yaml, rootSessionId: root.id })).orchestratorSessionId).toBe(root.id);
    expect(f.manager.getSessions(f.workspace.id)).toHaveLength(1);
  }
  finally {
    await f.cleanup();
  }
});
