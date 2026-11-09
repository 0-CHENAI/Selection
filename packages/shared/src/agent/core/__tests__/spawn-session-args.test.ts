import { describe, expect, it } from 'bun:test'
import {
  isSpawnSessionToolName,
  recoverSpawnSessionArguments,
} from '../spawn-session-args.ts'

const qualification = {
  tracks: [
    { name: 'a', input: 'a', expectedOutput: 'a', evidence: 'a', toolKinds: ['web_search'] },
    { name: 'b', input: 'b', expectedOutput: 'b', evidence: 'b', toolKinds: ['web_fetch'] },
  ],
  parallelBenefit: 'independent research',
  finalAggregation: 'merge the summaries',
}

describe('recoverSpawnSessionArguments', () => {
  it('hoists ORDER-stuffed top-level keys out of qualification', () => {
    const recovered = recoverSpawnSessionArguments({
      prompt: 'research three models',
      name: '调研 Hy4-preview',
      qualification: {
        ...qualification,
        role: 'worker',
        lifecycle: 'managed',
        spawnReason: 'automatic',
      },
    })

    expect(recovered.role).toBe('worker')
    expect(recovered.lifecycle).toBe('managed')
    expect(recovered.spawnReason).toBe('automatic')
    expect(recovered.qualification).toEqual(qualification)
  })

  it('does not overwrite top-level values already set by the model', () => {
    const recovered = recoverSpawnSessionArguments({
      prompt: 'research',
      role: 'reviewer',
      qualification: {
        ...qualification,
        role: 'worker',
      },
    })

    expect(recovered.role).toBe('reviewer')
    expect(recovered.qualification).toEqual(qualification)
  })

  it('drops unknown nested keys that would fail additionalProperties', () => {
    const recovered = recoverSpawnSessionArguments({
      prompt: 'research',
      qualification: {
        ...qualification,
        extra: 'nope',
      },
    })

    expect(recovered.qualification).toEqual(qualification)
    expect(recovered).not.toHaveProperty('extra')
  })

  it('does not hoist stuffed values that would fail the top-level schema', () => {
    const recovered = recoverSpawnSessionArguments({
      prompt: 'research',
      qualification: {
        ...qualification,
        role: 'lead',
        timeoutMs: '900000',
        spawnReason: true,
      },
    })

    expect(recovered).not.toHaveProperty('role')
    expect(recovered).not.toHaveProperty('timeoutMs')
    expect(recovered).not.toHaveProperty('spawnReason')
    expect(recovered.qualification).toEqual(qualification)
  })

  it('lifts help out of qualification so help mode is still reachable', () => {
    const recovered = recoverSpawnSessionArguments({
      qualification: {
        ...qualification,
        help: true,
      },
    })

    expect(recovered.help).toBe(true)
    expect(recovered.qualification).toEqual(qualification)
  })

  it('returns the same object when qualification is already clean', () => {
    const input = { prompt: 'research', qualification }
    expect(recoverSpawnSessionArguments(input)).toBe(input)
  })
})

describe('isSpawnSessionToolName', () => {
  it('matches prompt-facing and MCP-prefixed names', () => {
    expect(isSpawnSessionToolName('spawn_session')).toBe(true)
    expect(isSpawnSessionToolName('mcp__session__spawn_session')).toBe(true)
    expect(isSpawnSessionToolName('call_llm')).toBe(false)
  })
})
