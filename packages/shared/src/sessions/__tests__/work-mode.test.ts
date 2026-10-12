import { expect, test } from 'bun:test';
import { migrateWorkModes, complexCapabilityError, complexToolCapability, type WorkModeSession } from '../work-mode.ts';
import { getSessionToolProxyDefs } from '../../agent/backend/pi/session-tool-defs.ts';

test('Pi registry advertises only tools allowed by the persisted execution scope', () => {
  const names = (session: WorkModeSession) => getSessionToolProxyDefs({ executionSession: session }).map(def => def.name);
  const ordinary = names({ id: 'ordinary', workMode: 'NORM' });
  expect(ordinary).toContain('mcp__session__update_task_list');
  expect(ordinary.some(name => !!complexToolCapability(name))).toBe(false);
  const pro = names({ id: 'pro', workMode: 'PRO' });
  expect(pro).toContain('run_task');
  expect(pro).toContain('spawn_session');
  // A root can start a DAG in this turn; registration must already include its help reply tool.
  expect(pro).toContain('mcp__session__task_help');
  expect(ordinary).not.toContain('mcp__session__task_help');
  const worker = names({ id: 'worker', workMode: 'PRO', parentSessionId: 'pro', taskRunId: 'run', taskNodeId: 'a' });
  expect(worker).toContain('mcp__session__submit_task_output');
  expect(worker).not.toContain('mcp__session__update_task_list');
  expect(worker.some(name => !!complexToolCapability(name))).toBe(false);
  const unbound = names({ id: 'worker', workMode: 'PRO', parentSessionId: 'pro', taskNodeId: 'a' });
  for (const tool of ['submit_task_output', 'submit_task_node_verdict', 'task_help']) {
    expect(unbound.some(name => name.endsWith(tool))).toBe(false);
  }
});

test('all historical cases migrate idempotently without changing permissions or ownership', () => {
  const sessions = [
    { id: 'explicit', workMode: 'PRO' },
    { id: 'task', taskSlug: 'task', permissionMode: 'safe' },
    { id: 'swarm', permissionMode: 'ask' },
    { id: 'worker', parentSessionId: 'swarm', orchestrationId: 'run', orchestrationRootSessionId: 'swarm', orchestrationRole: 'worker', permissionMode: 'safe' },
    { id: 'toggle-only', swarmEnabled: true },
    { id: 'plain' },
    { id: 'unowned-node', taskNodeId: 'a', taskRunId: 'active' },
    { id: 'orphan', parentSessionId: 'missing', orchestrationId: 'active', orchestrationStatus: 'running', permissionMode: 'safe' },
    { id: 'contradiction', workMode: 'NORM', taskRunId: 'active', taskSlug: 'legacy', permissionMode: 'ask' },
    { id: 'reviewer', parentSessionId: 'task', taskNodeId: 'review', orchestrationRole: 'reviewer' },
    { id: 'cycle-a', parentSessionId: 'cycle-b' }, { id: 'cycle-b', parentSessionId: 'cycle-a' },
  ] as (WorkModeSession & { permissionMode?: string; swarmEnabled?: boolean })[];
  const original = JSON.stringify(sessions);
  const result = migrateWorkModes(sessions);
  expect(['explicit', 'task', 'swarm', 'worker', 'reviewer'].map(id => result.get(id)!.workMode)).toEqual(['PRO', 'PRO', 'PRO', 'PRO', 'PRO']);
  expect(result.get('worker')!.executionRootSessionId).toBe('swarm');
  expect(result.get('reviewer')!.executionRootSessionId).toBe('task');
  expect(['toggle-only', 'plain'].map(id => result.get(id)!.workMode)).toEqual(['NORM', 'NORM']);
  expect(result.get('unowned-node')).toMatchObject({ workMode: 'NORM', workModeNeedsReview: true });
  expect(result.get('orphan')).toMatchObject({ workMode: 'NORM', workModeNeedsReview: true });
  expect(result.get('contradiction')).toMatchObject({ workMode: 'NORM', workModeNeedsReview: true });
  expect(result.get('cycle-a')!.workModeNeedsReview).toBe(true);
  expect(migrateWorkModes(sessions.map(session => ({ ...session, ...result.get(session.id) })))).toEqual(result);
  expect(JSON.stringify(sessions)).toBe(original);
});

test('mode, root role and unresolved ownership gate all complex capability aliases', () => {
  for (const tool of ['Task', 'Agent', 'spawn_session', 'send_agent_message', 'mcp__session__spawn_session', 'session__run_task', 'create_task', 'submit_task_definition', 'submit_orchestration_patch']) {
    const capability = complexToolCapability(tool)!;
    expect(capability).toBeDefined();
    expect(complexCapabilityError({ workMode: 'NORM' }, capability)).toContain('NORM');
    expect(complexCapabilityError({ workMode: 'PRO', workModeNeedsReview: true }, capability)).toContain('review');
    expect(complexCapabilityError({ workMode: 'PRO', parentSessionId: 'root' }, capability)).toContain('coordinator');
    expect(complexCapabilityError({ workMode: 'PRO', orchestrationRole: 'reviewer' }, capability)).toContain('coordinator');
    expect(complexCapabilityError({ workMode: 'PRO' }, capability)).toBeUndefined();
  }
  for (const tool of ['Read', 'Write', 'Edit', 'Bash', 'update_task_list', 'source_test', 'skill_install', 'submit_answer']) expect(complexToolCapability(tool)).toBeUndefined();
});
