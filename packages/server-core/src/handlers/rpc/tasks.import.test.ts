import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { taskYamlPath } from '@craft-agent/shared/tasks'
import { registerTasksHandlers } from './tasks'
import type { RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

const yaml = 'schema_version: 3\nid: imported\ntitle: Imported\ngoal: Test\nnodes:\n  - id: one\n    prompt: Test\n'
const roots: string[] = []
const spies: Array<{ mockRestore(): void }> = []
afterEach(() => {
  spies.splice(0).forEach(spy => spy.mockRestore())
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

function setup(failSession = false, failSetup = false) {
  const root = mkdtempSync(join(tmpdir(), 'selection-yaml-import-'))
  roots.push(root)
  spies.push(spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ id: 'test', name: 'Test', rootPath: root } as ReturnType<typeof config.getWorkspaceByNameOrId>))
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  let sessions = 0
  registerTasksHandlers({ handle: (name: string, fn: (...args: any[]) => Promise<any>) => handlers.set(name, fn) } as unknown as RpcServer, {
    sessionManager: {
      setTaskRunnerLookup() {},
      async createSession() {
        if (failSession) throw new Error('session creation failed')
        sessions++; return { id: 'orch' }
      },
      applyTaskLabel() {
        if (failSetup) throw new Error('label setup failed')
        return Promise.resolve({ labelId: 'task' })
      },
      setSessionSources() { if (failSetup) throw new Error('sources setup failed') },
    },
  } as unknown as HandlerDeps)
  return { root, sessions: () => sessions, call: (channel: string, req: unknown) => handlers.get(channel)!({}, 'test', req) }
}

describe('YAML-only task RPC', () => {
  it('keeps a successfully created task when optional setup throws synchronously', async () => {
    const app = setup(false, true)
    const result = await app.call(RPC_CHANNELS.tasks.CREATE, { yaml: yaml + 'sources: [test-source]\n' })
    expect(result.validation.valid).toBe(true)
    expect(result.validation.warnings.length).toBe(2)
    expect(app.sessions()).toBe(1)
    expect(existsSync(taskYamlPath(app.root, 'imported'))).toBe(true)
  })
  it('does not leave an orphaned import after session creation fails', async () => {
    const app = setup(true)
    await expect(app.call(RPC_CHANNELS.tasks.CREATE, { yaml })).rejects.toThrow('session creation failed')
    expect(existsSync(taskYamlPath(app.root, 'imported'))).toBe(false)
  })
  it('imports V3 once and refuses overwrite without creating another session', async () => {
    const app = setup()
    const imported = await app.call(RPC_CHANNELS.tasks.CREATE, { yaml })
    expect(imported.validation.valid).toBe(true)
    expect(app.sessions()).toBe(1)
    const original = readFileSync(taskYamlPath(app.root, 'imported'), 'utf8')
    expect(original).toContain('schema_version: 3')
    await expect(app.call(RPC_CHANNELS.tasks.CREATE, { yaml: yaml.replace('title: Imported', 'title: Overwrite') })).rejects.toThrow('already exists')
    expect(readFileSync(taskYamlPath(app.root, 'imported'), 'utf8')).toBe(original)
    expect(app.sessions()).toBe(1)
  })
  it('rejects legacy import, generation and save-as-create without writing', async () => {
    const app = setup()
    const result = await app.call(RPC_CHANNELS.tasks.CREATE, { yaml: yaml.replace('schema_version: 3\n', '') })
    expect(result.validation.valid).toBe(false)
    await expect(app.call(RPC_CHANNELS.tasks.GENERATE, { goal: 'test' })).rejects.toThrow('disabled')
    await expect(app.call(RPC_CHANNELS.tasks.SAVE, { yaml, expectedEtag: null })).rejects.toThrow('existing task')
    expect(existsSync(taskYamlPath(app.root, 'imported'))).toBe(false)
    expect(app.sessions()).toBe(0)
  })
})
