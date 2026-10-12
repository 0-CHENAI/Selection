import { afterEach, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as config from '@craft-agent/shared/config'
import * as storage from '@craft-agent/shared/config/storage'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { parseTaskSpec, saveTaskSpec, serializeTaskYaml, readRunLog } from '@craft-agent/shared/tasks'
import { registerTasksHandlers } from './tasks'
import type { HandlerDeps } from '../handler-deps'
import type { RpcServer } from '../../transport'
import type { TaskRunner } from '../../tasks'

const roots: string[] = [], mocks: Array<{ mockRestore(): void }> = []
const flag = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE
afterEach(() => { mocks.splice(0).forEach(mock => mock.mockRestore()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); if (flag === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE; else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = flag })

it('the UI and planner share revision CAS, frozen history, protection and host work-mode checks', async () => {
  process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '1'
  const root = mkdtempSync(join(tmpdir(), 'plan-rpc-')); roots.push(root)
  mocks.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'ws', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  mocks.push(spyOn(storage, 'getDagOrchestrationEnabled').mockReturnValue(true))
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  let lookup: (workspaceId: string) => TaskRunner
  const owner = { id: 'root', workspaceId: 'ws', workMode: 'PRO', swarmEnabled: true }
  registerTasksHandlers({ handle: (channel: string, fn: any) => handlers.set(channel, fn), push() {} } as unknown as RpcServer, {
    sessionManager: { setTaskRunnerLookup(fn: typeof lookup) { lookup = fn },
      async getSession() { return owner }, getSessionWorkingDirectory() { return undefined }, async createSession(_ws: string, options: any) { return { id: `sess-${options.name}` } },
      async sendMessage() {}, async setTaskNodeCount() {}, async setSessionStatus() {}, async setKanbanColumn() {}, onSessionComplete() { return () => {} },
    },
  } as unknown as HandlerDeps)
  const parsed = parseTaskSpec({ schema_version: 3, id: 'plan', title: 'Plan', goal: 'g', runner: 'orchestrate', execution: { coordinator_gate: { mode: 'off' } }, constraints: ['read only'], locked_fields: ['constraints'], nodes: [{ id: 'a', prompt: 'A' }, { id: 'c', prompt: 'C', depends_on: ['a'] }] })
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error))
  saveTaskSpec(root, parsed.data)
  const runner = lookup!('ws'); runner.run('plan', { runId: 'r', orchestratorSessionId: 'root', orchestrateAllowed: true, verifyOnComplete: false })
  await new Promise(resolve => setTimeout(resolve, 0))
  const manual = structuredClone(parsed.data); manual.nodes[1]!.prompt = 'reviewed C'
  const req = { slug: 'plan', runId: 'r', baseRevision: 0, yaml: serializeTaskYaml(manual), rationale: 'confirmed' }
  const results = await Promise.all([handlers.get(RPC_CHANNELS.tasks.PATCH_RUN)!({}, 'ws', req), handlers.get(RPC_CHANNELS.tasks.PATCH_RUN)!({}, 'ws', { ...req, yaml: req.yaml.replace('reviewed C', 'other C') })])
  if (results.every(result => result.conflict)) throw new Error(JSON.stringify({ conflicts: results.map(result => result.conflict), log: readRunLog(root, 'plan', 'r') }))
  expect(results.filter(result => !result.conflict)).toHaveLength(1)
  expect(results.find(result => result.conflict).conflict.message).toContain('stale revision')
  expect(runner.currentRunSpec('plan', 'r')!.nodes[1]!.prompt).toBe('reviewed C')
  expect(readRunLog(root, 'plan', 'r').filter(event => event.kind === 'orchestration-patch')).toHaveLength(1)
  const locked = structuredClone(manual); locked.constraints = ['write files']
  const lockResult = await handlers.get(RPC_CHANNELS.tasks.PATCH_RUN)!({}, 'ws', { ...req, baseRevision: 1, yaml: serializeTaskYaml(locked) })
  expect(lockResult.conflict.message).toContain('Locked field "constraints"')
  expect(runner.currentRunSpec('plan', 'r')!.constraints).toEqual(['read only'])
  await expect(handlers.get(RPC_CHANNELS.tasks.RUN)!({}, 'ws', { slug: 'plan', orchestratorSessionId: 'root', expectedEtag: 'replaced-definition' })).rejects.toThrow('Saved task changed before run')
  owner.workMode = 'NORM'
  await expect(handlers.get(RPC_CHANNELS.tasks.PATCH_RUN)!({}, 'ws', { ...req, baseRevision: 1 })).rejects.toThrow('NORM')
  expect(runner.getRunState('plan', 'r')!.revision).toBe(1)
})
