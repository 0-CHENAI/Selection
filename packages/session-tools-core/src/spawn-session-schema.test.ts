import { describe, expect, it } from 'bun:test'
import { SpawnSessionSchema, getToolDefsAsJsonSchema } from './tool-defs.ts'

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
        role: 'worker',
        lifecycle: 'managed',
      },
      lifecycle: 'managed',
      role: 'worker',
    }).success).toBe(true)
  })

  it('publishes qualification as an open object so ORDER-stuffed keys do not fail Pi validation', () => {
    const spawn = getToolDefsAsJsonSchema().find(def => def.name === 'spawn_session')
    const properties = spawn?.inputSchema.properties as Record<string, { additionalProperties?: unknown }> | undefined
    expect(properties?.qualification?.additionalProperties).not.toBe(false)
  })

  it('tells the model to pass a qualification object rather than a name phrase', () => {
    const spawn = getToolDefsAsJsonSchema().find(def => def.name === 'spawn_session')
    expect(spawn?.description).toContain('qualification object')
    expect(spawn?.description).toContain('not a phrase in name or prompt')
  })
})
