import { describe, expect, it } from 'bun:test'
import { parseTaskSpec } from '@craft-agent/shared/tasks'
import { inheritTaskExecutionDefaults, resolveCreateTaskProjectId } from './create-task'

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
