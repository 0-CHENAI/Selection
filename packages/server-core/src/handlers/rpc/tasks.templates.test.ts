import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { taskTemplateYamlPath, taskYamlPath } from '@craft-agent/shared/tasks'
import { registerTasksHandlers } from './tasks'
import type { RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

const yaml = 'schema_version: 3\nid: imported\ntitle: Imported\ngoal: Test\nparams:\n  - name: token\n    sensitive: true\n    default: secret\nnodes:\n  - id: one\n    prompt: Test\n'
const roots: string[] = []
const spies: Array<{ mockRestore(): void }> = []
afterEach(() => {
  spies.splice(0).forEach(spy => spy.mockRestore())
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'selection-templates-'))
  roots.push(root)
  spies.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'test', name: 'Test', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  let sessions = 0
  registerTasksHandlers({ handle: (name: string, fn: (...args: any[]) => Promise<any>) => handlers.set(name, fn) } as unknown as RpcServer, {
    sessionManager: {
      setTaskRunnerLookup() {},
      async createSession() { sessions++; return { id: `orch-${sessions}` } },
      applyTaskLabel() { return Promise.resolve({ labelId: 'task' }) },
      setSessionSources() {},
    },
  } as unknown as HandlerDeps)
  return {
    root,
    sessions: () => sessions,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!( {}, 'test', ...args),
  }
}

describe('orchestration template RPC', () => {
  it('saves a template without creating a task session and strips secrets', async () => {
    const app = setup()
    const saved = await app.call(RPC_CHANNELS.tasks.SAVE_TEMPLATE, {
      name: 'Code Review',
      description: 'Reusable review',
      tags: ['review'],
      yaml,
    })
    expect(saved.id).toBe('code-review')
    expect(saved.validation.valid).toBe(true)
    expect(app.sessions()).toBe(0)
    expect(existsSync(taskYamlPath(app.root, 'imported'))).toBe(false)
    const listed = await app.call(RPC_CHANNELS.tasks.LIST_TEMPLATES)
    expect(listed).toEqual([expect.objectContaining({ id: 'code-review', name: 'Code Review', nodeCount: 1 })])
    const detail = await app.call(RPC_CHANNELS.tasks.GET_TEMPLATE, 'code-review')
    expect(detail.yaml).not.toContain('secret')
    expect(detail.spec.params).toEqual([{ name: 'token', sensitive: true }])
    expect(readFileSync(taskTemplateYamlPath(app.root, 'code-review'), 'utf8')).toContain('schema_version: 3')
  })

  it('rejects legacy YAML and duplicate names without writing a second template', async () => {
    const app = setup()
    const invalid = await app.call(RPC_CHANNELS.tasks.SAVE_TEMPLATE, {
      name: 'Legacy',
      yaml: yaml.replace('schema_version: 3\n', ''),
    })
    expect(invalid.validation.valid).toBe(false)
    expect(invalid.id).toBe('')
    await app.call(RPC_CHANNELS.tasks.SAVE_TEMPLATE, { name: 'Review', yaml })
    await expect(app.call(RPC_CHANNELS.tasks.SAVE_TEMPLATE, { name: 'review', yaml })).rejects.toThrow('already exists')
    expect(await app.call(RPC_CHANNELS.tasks.LIST_TEMPLATES)).toHaveLength(1)
  })

  it('creates a new task from a template without rewriting the template or auto-running', async () => {
    const app = setup()
    await app.call(RPC_CHANNELS.tasks.SAVE_TEMPLATE, { name: 'Imported', yaml })
    const live = await app.call(RPC_CHANNELS.tasks.CREATE, {
      yaml: 'schema_version: 3\nid: imported\ntitle: Live\ngoal: Test\nnodes:\n  - id: one\n    prompt: Test\n',
    })
    expect(live.slug).toBe('imported')
    const created = await app.call(RPC_CHANNELS.tasks.CREATE_FROM_TEMPLATE, { templateId: 'imported', projectId: 'proj-1' })
    expect(created.validation.valid).toBe(true)
    expect(created.slug).toBe('imported-2')
    expect(created.orchestratorSessionId).toBe('orch-2')
    expect(app.sessions()).toBe(2)
    expect(existsSync(taskYamlPath(app.root, 'imported-2'))).toBe(true)
    expect(readFileSync(taskYamlPath(app.root, 'imported-2'), 'utf8')).toContain('project: proj-1')
    expect((await app.call(RPC_CHANNELS.tasks.GET_TEMPLATE, 'imported')).spec.id).toBe('imported')
  })

  it('deletes a template without removing instantiated tasks', async () => {
    const app = setup()
    await app.call(RPC_CHANNELS.tasks.SAVE_TEMPLATE, { name: 'Imported', yaml })
    const created = await app.call(RPC_CHANNELS.tasks.CREATE_FROM_TEMPLATE, { templateId: 'imported' })
    expect((await app.call(RPC_CHANNELS.tasks.DELETE_TEMPLATE, 'imported')).deleted).toBe(true)
    expect(await app.call(RPC_CHANNELS.tasks.LIST_TEMPLATES)).toEqual([])
    expect(existsSync(taskYamlPath(app.root, created.slug))).toBe(true)
    expect(app.sessions()).toBe(1)
  })
})
