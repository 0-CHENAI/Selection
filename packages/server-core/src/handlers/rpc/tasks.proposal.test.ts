import { afterEach, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { rememberSubmittedDefinition } from '../../tasks/submitted-definitions'
import { registerTasksHandlers } from './tasks'
import type { HandlerDeps } from '../handler-deps'
import type { RpcServer } from '../../transport'

const roots: string[] = []
const mocks: Array<{ mockRestore(): void }> = []
afterEach(() => { mocks.splice(0).forEach(m => m.mockRestore()); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })) })

it('generates only a V3 proposal in safe mode, pushes it, and disposes the draft without creating tasks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proposal-rpc-')); roots.push(root)
  mocks.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'ws', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  const handlers = new Map<string, (...args: any[]) => any>()
  const pushed: any[][] = []
  let listener: ((event: any) => void) | undefined
  const deleted: string[] = []
  let options: any
  registerTasksHandlers({ handle: (name: string, fn: any) => handlers.set(name, fn), push: (...args: any[]) => pushed.push(args) } as unknown as RpcServer, {
    sessionManager: {
      setTaskRunnerLookup() {},
      async createSession(_ws: string, opts: any) { options = opts; return { id: 'draft' } },
      onSessionComplete(fn: any) { listener = fn; return () => { listener = undefined } },
      async sendMessage() {
        rememberSubmittedDefinition('draft', 1, 'schema_version: 3\nid: proposal\ntitle: Proposal\ngoal: g\nnodes:\n  - id: review\n    kind: approval\n')
        listener?.({ sessionId: 'draft', generation: 1, finalText: 'Submitted' })
      },
      async deleteSession(id: string) { deleted.push(id) },
    },
  } as unknown as HandlerDeps)
  const ack = await handlers.get(RPC_CHANNELS.tasks.GENERATE)!({}, 'ws', { goal: 'Propose a human review', permissionMode: 'allow-all' })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(ack.orchestratorSessionId).toBe('draft')
  expect(options.permissionMode).toBe('safe')
  expect(options.taskDraft).toBe(true)
  expect(pushed[0]?.[3]?.validation.valid).toBe(true)
  expect(pushed[0]?.[3]?.spec.schema_version).toBe(3)
  expect(deleted).toEqual(['draft'])
  expect(listener).toBeUndefined()
  expect(readdirSync(root)).toEqual([])
})

it('refuses to save a missing task with an editor-first error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proposal-save-')); roots.push(root)
  mocks.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'ws', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  const handlers = new Map<string, (...args: any[]) => any>()
  registerTasksHandlers({ handle: (name: string, fn: any) => handlers.set(name, fn), push() {} } as unknown as RpcServer, {
    sessionManager: { setTaskRunnerLookup() {} },
  } as unknown as HandlerDeps)
  await expect(handlers.get(RPC_CHANNELS.tasks.SAVE)!({}, 'ws', {
    yaml: 'schema_version: 3\nid: missing\ntitle: Missing\ngoal: g\nnodes:\n  - id: a\n    prompt: p\n',
  })).rejects.toThrow('Create the workflow in the editor first')
})

it('carries previous outcomes and the latest manual draft, repairs changed task ids, and never writes a task', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proposal-rounds-')); roots.push(root)
  mocks.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'ws', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  const handlers = new Map<string, (...args: any[]) => any>(), pushed: any[][] = [], prompts: string[] = []
  let listener: ((event: any) => void) | undefined, generation = 0
  const current = 'schema_version: 3\nid: existing\ntitle: Existing\ngoal: g\nnodes:\n  - id: a\n    prompt: manual prompt\n    model: manual-model\n    llmConnection: manual-connection\n  - id: b\n    prompt: report\n    depends_on: [a]\n'
  registerTasksHandlers({ handle: (name: string, fn: any) => handlers.set(name, fn), push: (...args: any[]) => pushed.push(args) } as unknown as RpcServer, {
    sessionManager: {
      setTaskRunnerLookup() {}, async createSession() { return { id: 'draft' } },
      onSessionComplete(fn: any) { listener = fn; return () => { listener = undefined } },
      async sendMessage(_session: string, prompt: string) {
        prompts.push(prompt); generation++
        // The repair loop must reject a valid graph whose task id changed.
        rememberSubmittedDefinition('draft', generation, generation === 1 ? current.replace('id: existing', 'id: recreated') : current.replace('prompt: report', 'prompt: 中文报告'))
        listener?.({ sessionId: 'draft', generation, finalText: 'Submitted' })
      }, async deleteSession() {},
    },
  } as unknown as HandlerDeps)
  await handlers.get(RPC_CHANNELS.tasks.GENERATE)!({}, 'ws', {
    goal: 'only change b', currentYaml: current,
    conversation: [{ goal: 'create', yaml: current.replace('manual prompt', 'old prompt'), status: 'applied' }, { goal: 'delete a', status: 'discarded' }],
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(prompts[0]).toContain('manual prompt')
  expect(prompts[0]).toContain('manual-connection')
  expect(prompts[0]).toContain('"status":"discarded"')
  expect(prompts[0].lastIndexOf('manual prompt')).toBeGreaterThan(prompts[0].indexOf('old prompt'))
  expect(prompts[1]).toContain('Preserve the existing task id: existing')
  expect(pushed[0][3].spec.id).toBe('existing')
  expect(pushed[0][3].spec.nodes[0].model).toBe('manual-model')
  expect(readdirSync(root)).toEqual([])
})

it('rejects malformed conversation at the RPC boundary before creating a session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'proposal-input-')); roots.push(root)
  mocks.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'ws', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  const handlers = new Map<string, (...args: any[]) => any>()
  registerTasksHandlers({ handle: (name: string, fn: any) => handlers.set(name, fn), push() {} } as unknown as RpcServer, { sessionManager: { setTaskRunnerLookup() {} } } as unknown as HandlerDeps)
  for (const conversation of [{}, [{ goal: 'change', status: 'unknown' }], [{ goal: 1, status: 'applied' }], [{ goal: 'g', status: 'applied', yaml: {} }]]) {
    await expect(handlers.get(RPC_CHANNELS.tasks.GENERATE)!({}, 'ws', { goal: 'change', conversation })).rejects.toThrow('Invalid proposal conversation')
  }
  expect(readdirSync(root)).toEqual([])
})
