import { describe, expect, it } from 'bun:test'
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  prepareSpawnFanOutQualifications,
  SpawnFanOutQualificationCache,
} from './spawn-fan-out-preparation.ts'

const calls = [
  { type: 'toolCall', id: 'a', name: 'spawn_session', arguments: { name: '代码', prompt: '审查代码' } },
  { type: 'toolCall', id: 'b', name: 'spawn_session', arguments: { name: '业务', prompt: '审查业务' } },
  { type: 'toolCall', id: 'c', name: 'spawn_session', arguments: { name: '测试', prompt: '审查测试' } },
]

const parameters = Type.Object({
  prompt: Type.String(),
  name: Type.Optional(Type.String()),
  lifecycle: Type.Optional(Type.Union([Type.Literal('managed'), Type.Literal('detached')])),
  qualification: Type.Optional(Type.Unknown()),
}, { additionalProperties: false })

function tool(name = 'spawn_session'): ToolDefinition<any, any> {
  return {
    name,
    label: name,
    description: 'spawn a child session',
    parameters,
    execute: async () => ({ content: [], details: {} }),
  }
}

describe('prepareSpawnFanOutQualifications', () => {
  it('prepares one complete contract for every missing qualification in a parallel batch', () => {
    const prepared = prepareSpawnFanOutQualifications('toolUse', calls, [tool()])

    expect([...prepared.keys()]).toEqual(['a', 'b', 'c'])
    expect(prepared.get('a')).toBe(prepared.get('b'))
    expect(prepared.get('a')?.tracks.map(track => track.name)).toEqual(['代码', '业务', '测试'])
  })

  it('does nothing for terminal responses that Pi will not execute', () => {
    for (const stopReason of ['length', 'error', 'aborted', undefined]) {
      expect(prepareSpawnFanOutQualifications(stopReason, calls, [tool()]).size).toBe(0)
    }
  })

  it('does not invent a fan-out contract for one or duplicate tracks', () => {
    expect(prepareSpawnFanOutQualifications('toolUse', calls.slice(0, 1), [tool()]).size).toBe(0)
    expect(prepareSpawnFanOutQualifications('toolUse', [calls[0], {
      ...calls[1],
      arguments: { name: '代码', prompt: '重复代码审查' },
    }], [tool()]).size).toBe(0)
  })

  it('preserves an explicit qualification while preparing missing siblings', () => {
    const explicit = {
      tracks: [],
      parallelBenefit: 'explicit',
      finalAggregation: 'explicit',
    }
    const prepared = prepareSpawnFanOutQualifications('stop', [
      { ...calls[0], arguments: { ...calls[0].arguments, qualification: explicit } },
      calls[1],
    ], [tool()])

    expect(prepared.has('a')).toBe(false)
    expect(prepared.has('b')).toBe(true)
  })

  it('ignores schema-invalid siblings instead of authorizing a lone valid spawn', () => {
    const prepared = prepareSpawnFanOutQualifications('toolUse', [
      calls[0],
      { ...calls[1], arguments: { ...calls[1].arguments, lifecycle: 'invalid' } },
    ], [tool()])

    expect(prepared.size).toBe(0)
  })

  it('ignores unregistered or third-party spawn_session suffixes', () => {
    for (const name of ['evil__spawn_session', 'mcp__third_party__spawn_session']) {
      const prepared = prepareSpawnFanOutQualifications('toolUse', [
        calls[0],
        { ...calls[1], name },
      ], [tool()])
      expect(prepared.size).toBe(0)
    }
  })

  it('accepts only a registered canonical session alias', () => {
    const canonicalCalls = calls.slice(0, 2).map(call => ({
      ...call,
      name: 'mcp__session__spawn_session',
    }))

    expect(prepareSpawnFanOutQualifications(
      'toolUse',
      canonicalCalls,
      [tool('mcp__session__spawn_session')],
    ).size).toBe(2)
  })

  it('serves every call by id despite asymmetric execution delays', async () => {
    const cache = new SpawnFanOutQualificationCache()
    cache.prepare('toolUse', calls, [tool()])

    const qualifications = await Promise.all([
      new Promise(resolve => setTimeout(() => resolve(cache.consume('a')), 3)),
      new Promise(resolve => setTimeout(() => resolve(cache.consume('b')), 1)),
      new Promise(resolve => setTimeout(() => resolve(cache.consume('c')), 2)),
    ])

    expect(qualifications.every(Boolean)).toBe(true)
    expect(qualifications[0]).toBe(qualifications[1])
    expect(cache.consume('a')).toBeUndefined()
  })

  it('drops unconsumed call ids when a turn terminates', () => {
    const cache = new SpawnFanOutQualificationCache()
    cache.prepare('toolUse', calls, [tool()])
    cache.clear()

    expect(cache.consume('a')).toBeUndefined()
    expect(cache.consume('b')).toBeUndefined()
    expect(cache.consume('c')).toBeUndefined()
  })
})
