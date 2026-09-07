import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseTaskSpec, taskYamlPath } from '@craft-agent/shared/tasks'
import type { ISessionManager } from '../handlers/session-manager-interface'
import { createTaskFromSpec, inheritTaskExecutionDefaults, resolveCreateTaskProjectId } from './create-task'

function specOf(raw: unknown) {
  const parsed = parseTaskSpec(raw)
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues))
  return parsed.data
}

describe('resolveCreateTaskProjectId', () => {
  it('inherits the invoking session project when no override is supplied', () => {
    expect(resolveCreateTaskProjectId(undefined, 'project-current')).toBe('project-current')
  })

  it('prefers an explicit project over the invoking session project', () => {
    expect(resolveCreateTaskProjectId('project-explicit', 'project-current')).toBe('project-explicit')
  })

  it('leaves tasks unbound when neither side has a project', () => {
    expect(resolveCreateTaskProjectId(undefined, undefined)).toBeUndefined()
  })
})

function stubSessionManager(): ISessionManager {
  return {
    createSession: async () => ({ id: 'orch-1' }),
    applyTaskLabel: async () => ({ labelId: 'task' }),
    setSessionSources: () => undefined,
  } as unknown as ISessionManager
}

describe('createTaskFromSpec schema version', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
    roots.length = 0
  })

  it('stamps schema_version 3 on a new task', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-task-'))
    roots.push(root)
    await createTaskFromSpec(
      stubSessionManager(),
      'ws',
      root,
      specOf({ id: 'demo', title: 'Demo', goal: 'g', nodes: [{ id: 'main', prompt: 'do it' }] }),
    )
    expect(readFileSync(taskYamlPath(root, 'demo'), 'utf-8')).toContain('schema_version: 3')
  })

  it('keeps an explicit schema_version 2', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-task-'))
    roots.push(root)
    await createTaskFromSpec(
      stubSessionManager(),
      'ws',
      root,
      specOf({
        schema_version: 2,
        id: 'legacy',
        title: 'Legacy',
        goal: 'g',
        nodes: [{ id: 'main', prompt: 'do it' }],
      }),
    )
    expect(readFileSync(taskYamlPath(root, 'legacy'), 'utf-8')).toContain('schema_version: 2')
  })

  it('converts cache: pure to run-pure on a new v3 create', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-task-'))
    roots.push(root)
    await createTaskFromSpec(
      stubSessionManager(),
      'ws',
      root,
      specOf({
        id: 'cached',
        title: 'Cached',
        goal: 'g',
        nodes: [{ id: 'main', prompt: 'do it', cache: 'pure' }],
      }),
    )
    const yaml = readFileSync(taskYamlPath(root, 'cached'), 'utf-8')
    expect(yaml).toContain('schema_version: 3')
    expect(yaml).toContain('run-pure')
    expect(yaml).not.toMatch(/cache:\s*pure\b/)
  })
})

describe('inheritTaskExecutionDefaults', () => {
  const base = {
    id: 'demo',
    title: 'Demo',
    goal: 'g',
    nodes: [{ id: 'main', prompt: 'do it' }],
  }

  it('fills omitted model and connection from the invoking session', () => {
    const inherited = inheritTaskExecutionDefaults(specOf(base), {
      model: 'qwen/qwen3-max',
      llmConnection: 'qwen-conn',
    })
    expect(inherited.defaults).toEqual({ model: 'qwen/qwen3-max', llmConnection: 'qwen-conn' })
  })

  it('fills only the omitted execution field from the invoking session', () => {
    const inherited = inheritTaskExecutionDefaults(
      specOf({ ...base, defaults: { llmConnection: 'pi-conn' } }),
      { model: 'qwen/qwen3-max', llmConnection: 'qwen-conn' },
    )
    expect(inherited.defaults).toEqual({ model: 'qwen/qwen3-max', llmConnection: 'pi-conn' })
  })

  it('keeps an explicit task default instead of the session model', () => {
    const inherited = inheritTaskExecutionDefaults(
      specOf({ ...base, defaults: { model: 'pi/gpt-5-mini', llmConnection: 'pi-conn' } }),
      { model: 'qwen/qwen3-max', llmConnection: 'qwen-conn' },
    )
    expect(inherited.defaults).toEqual({ model: 'pi/gpt-5-mini', llmConnection: 'pi-conn' })
  })

  it('returns the same spec when neither side has execution defaults', () => {
    const spec = specOf(base)
    expect(inheritTaskExecutionDefaults(spec, {})).toBe(spec)
  })
})
