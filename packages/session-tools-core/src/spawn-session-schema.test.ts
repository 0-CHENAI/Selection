import { describe, expect, it } from 'bun:test'
import { SpawnSessionSchema } from './tool-defs.ts'

describe('spawn_session schema', () => {
  it('closes qualification before the remaining top-level controls', () => {
    const keys = SpawnSessionSchema.keyof().options
    expect(keys.indexOf('qualification')).toBeGreaterThan(keys.indexOf('spawnReason'))
    expect(keys.indexOf('qualification')).toBeLessThan(keys.indexOf('lifecycle'))
    expect(keys.indexOf('qualification')).toBeLessThan(keys.indexOf('role'))
    expect(SpawnSessionSchema.safeParse({
      prompt: 'work',
      spawnReason: 'automatic',
      qualification: {
        tracks: [
          { name: 'a', input: 'a', expectedOutput: 'a', evidence: 'a', toolKinds: ['read'] },
          { name: 'b', input: 'b', expectedOutput: 'b', evidence: 'b', toolKinds: ['read'] },
        ],
        parallelBenefit: 'parallel',
        finalAggregation: 'merge',
      },
      lifecycle: 'managed',
      role: 'worker',
    }).success).toBe(true)
  })
})
