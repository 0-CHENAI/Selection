import { describe, expect, it } from 'bun:test'
import { Type } from '@sinclair/typebox'
import { validateToolArguments } from '@earendil-works/pi-ai/compat'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { getToolDefsAsJsonSchema } from '../../session-tools-core/src/tool-defs.ts'
import {
  prepareSpawnFanOutQualifications,
  SpawnFanOutQualificationCache,
} from './spawn-fan-out-preparation.ts'
import { createRecoveringArgumentPreparer } from './tool-argument-recovery.ts'

const calls = [
  { type: 'toolCall', id: 'a', name: 'spawn_session', arguments: { name: '代码', prompt: '审查代码' } },
  { type: 'toolCall', id: 'b', name: 'spawn_session', arguments: { name: '业务', prompt: '审查业务' } },
  { type: 'toolCall', id: 'c', name: 'spawn_session', arguments: { name: '测试', prompt: '审查测试' } },
]

const looseParameters = Type.Object({
  prompt: Type.String(),
  name: Type.Optional(Type.String()),
  lifecycle: Type.Optional(Type.Union([Type.Literal('managed'), Type.Literal('detached')])),
  qualification: Type.Optional(Type.Unknown()),
}, { additionalProperties: false })

const strictParameters = getToolDefsAsJsonSchema()
  .find(def => def.name === 'spawn_session')?.inputSchema

function tool(
  name = 'spawn_session',
  parameters: ToolDefinition<any, any>['parameters'] = looseParameters,
): ToolDefinition<any, any> {
  return {
    name,
    label: name,
    description: 'spawn a child session',
    parameters,
    prepareArguments: createRecoveringArgumentPreparer(name),
    execute: async () => ({ content: [], details: {} }),
  }
}

function legacySingleTrackCalls(names = ['Hy4-preview', 'GLM-5.3', 'Kimi K3']) {
  return names.map((name, index) => ({
    type: 'toolCall',
    id: `legacy-${index}`,
    name: 'spawn_session',
    arguments: {
      name,
      prompt: `Research ${name}`,
      spawnReason: 'automatic',
      role: 'worker',
      lifecycle: 'managed',
      qualification: {
        tracks: [{
          name: `${name} research`,
          input: name,
          expectedOutput: `Report about ${name}`,
          evidence: `Sources for ${name}`,
          toolKinds: ['web-search', 'web-fetch'],
        }],
        parallelBenefit: 'The three research tracks are independent.',
        finalAggregation: 'The coordinator compares all three reports.',
      },
    },
  }))
}

describe('prepareSpawnFanOutQualifications', () => {
  it('upgrades distinct legacy one-track calls to one V3 contract before real schema validation', () => {
    expect(strictParameters).toBeDefined()
    const strictTool = tool('spawn_session', strictParameters as ToolDefinition<any, any>['parameters'])
    const batch = legacySingleTrackCalls()

    const prepared = prepareSpawnFanOutQualifications('toolUse', batch, [strictTool])
    const qualification = prepared.get('legacy-0')

    expect([...prepared.keys()]).toEqual(['legacy-0', 'legacy-1', 'legacy-2'])
    expect(qualification?.tracks.map(track => track.name)).toEqual(['Hy4-preview', 'GLM-5.3', 'Kimi K3'])
    for (const call of batch) {
      const args = call.arguments as Record<string, unknown>
      expect(args.qualification).toBe(qualification)
      expect(() => validateToolArguments(strictTool, {
        type: 'toolCall',
        id: call.id,
        name: call.name,
        arguments: strictTool.prepareArguments?.(args) ?? args,
      })).not.toThrow()
    }
  })

  it('does not upgrade one legacy single-track call or duplicate worker tracks', () => {
    expect(strictParameters).toBeDefined()
    const strictTool = tool('spawn_session', strictParameters as ToolDefinition<any, any>['parameters'])
    const single = legacySingleTrackCalls().slice(0, 1)
    const singleQualification = single[0]!.arguments.qualification

    expect(prepareSpawnFanOutQualifications('toolUse', single, [strictTool]).size).toBe(0)
    expect(single[0]!.arguments.qualification).toBe(singleQualification)

    const duplicates = legacySingleTrackCalls(['same worker', 'same worker'])
    const duplicateQualifications = duplicates.map(call => call.arguments.qualification)
    expect(prepareSpawnFanOutQualifications('toolUse', duplicates, [strictTool]).size).toBe(0)
    expect(duplicates.map(call => call.arguments.qualification)).toEqual(duplicateQualifications)
  })

  it('does not let legacy qualification recovery hide another schema error', () => {
    expect(strictParameters).toBeDefined()
    const strictTool = tool('spawn_session', strictParameters as ToolDefinition<any, any>['parameters'])
    const batch = legacySingleTrackCalls()
    batch[1]!.arguments.lifecycle = 'invalid'

    expect(prepareSpawnFanOutQualifications('toolUse', batch.slice(0, 2), [strictTool]).size).toBe(0)
    expect((batch[0]!.arguments.qualification.tracks)).toHaveLength(1)
    expect((batch[1]!.arguments.qualification.tracks)).toHaveLength(1)
  })

  it('preserves a complete explicit V3 contract unchanged', () => {
    expect(strictParameters).toBeDefined()
    const strictTool = tool('spawn_session', strictParameters as ToolDefinition<any, any>['parameters'])
    const batch = legacySingleTrackCalls().slice(0, 2)
    const explicitV3 = {
      tracks: batch.map(call => ({
        name: call.arguments.name,
        input: call.arguments.prompt,
        expectedOutput: `Report from ${call.arguments.name}`,
        evidence: `Sources from ${call.arguments.name}`,
        toolKinds: ['web-search', 'web-fetch'],
      })),
      parallelBenefit: 'Both research tracks can run independently.',
      finalAggregation: 'The coordinator compares both reports.',
    }
    for (const call of batch)
      call.arguments.qualification = explicitV3

    const prepared = prepareSpawnFanOutQualifications('toolUse', batch, [strictTool])

    expect(prepared.size).toBe(0)
    for (const call of batch)
      expect(call.arguments.qualification).toBe(explicitV3)
  })

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
