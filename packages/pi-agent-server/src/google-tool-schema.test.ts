import { describe, expect, it } from 'bun:test'
import { getToolDefsAsJsonSchema } from '../../session-tools-core/src/tool-defs.ts'
import { convertTools } from '@earendil-works/pi-ai/api/google-shared'
import {
  flattenGoogleRootUnionSchema,
  installGoogleToolSchemaSanitizer,
  sanitizeGoogleGenerateContentPayload,
} from './google-tool-schema.ts'

describe('google-tool-schema', () => {
  it('flattens office_business root anyOf union for Gemini VALIDATED tool calling', () => {
    const defs = getToolDefsAsJsonSchema({ prefix: 'mcp__session__' })
    const officeDef = defs.find((d) => d.name === 'mcp__session__office_business')
    expect(officeDef).toBeDefined()

    const converted = convertTools(
      [{ name: officeDef!.name, description: officeDef!.description, parameters: officeDef!.inputSchema as any }],
      false,
      true,
    )
    const rawPayload = {
      model: 'gemini-4-hydrogen',
      contents: [],
      config: {
        tools: converted,
        toolConfig: { functionCallingConfig: { mode: 'VALIDATED' } },
      },
    }

    const sanitized = sanitizeGoogleGenerateContentPayload(rawPayload)
    expect(sanitized).not.toBe(rawPayload)

    const decl = sanitized.config.tools![0]!.functionDeclarations![0]!
    const schema = decl.parametersJsonSchema as Record<string, any>
    expect(schema.type).toBe('object')
    expect(schema.anyOf).toBeUndefined()
    expect(schema.oneOf).toBeUndefined()
    expect(schema.required).toEqual(['command'])
    expect(schema.properties.command).toEqual({
      type: 'string',
      enum: ['validate-minutes', 'metrics', 'quick-ratio', 'unit-economics', 'data-quality', 'infographic'],
    })
    expect(schema.properties.path.type).toBe('string')
    expect(schema.properties.path.description).toContain('.md')
    expect(schema.properties.path.description).toContain('CSV')
    expect(schema.properties.mrr.type).toBe('number')
    expect(schema.properties.config.type).toBe('object')
  })

  it('returns the original payload reference untouched when no declaration has a root union', () => {
    const payload = {
      model: 'gemini-4-hydrogen',
      config: {
        tools: [{
          functionDeclarations: [{
            name: 'read',
            parametersJsonSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          }],
        }],
      },
    }
    expect(sanitizeGoogleGenerateContentPayload(payload)).toBe(payload)
  })

  it('preserves conflicting property types across branches as property-level anyOf', () => {
    const flattened = flattenGoogleRootUnionSchema({
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['a'] },
            value: { type: 'string' },
          },
          required: ['mode', 'value'],
        },
        {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['b'] },
            value: { type: 'number' },
          },
          required: ['mode'],
        },
      ],
    })

    expect(flattened.required).toEqual(['mode'])
    expect((flattened.properties as any).mode.enum).toEqual(['a', 'b'])
    expect((flattened.properties as any).value.anyOf).toEqual([
      { type: 'string' },
      { type: 'number' },
    ])
  })

  it('chains onPayload for Google APIs and skips non-Google APIs', async () => {
    let seenGoogleOptions: any
    let seenOpenAiOptions: any
    const fakeSession = {
      agent: {
        streamFunction: (model: any, _ctx: any, options: any) => {
          if (model.api === 'google-generative-ai') seenGoogleOptions = options
          else seenOpenAiOptions = options
          return 'stream'
        },
      },
    } as any

    installGoogleToolSchemaSanitizer(fakeSession)

    fakeSession.agent.streamFunction(
      { api: 'openai-completions', provider: 'openai', id: 'gpt-5' },
      {},
      { onPayload: (p: any) => p },
    )
    expect(seenOpenAiOptions.onPayload).toBeDefined()

    const upstreamHook = async (payload: any) => ({ ...payload, tagged: true })
    fakeSession.agent.streamFunction(
      { api: 'google-generative-ai', provider: 'google', id: 'gemini-4-hydrogen' },
      {},
      { onPayload: upstreamHook },
    )

    const transformed = await seenGoogleOptions.onPayload({
      config: {
        tools: [{
          functionDeclarations: [{
            name: 'union_tool',
            parametersJsonSchema: {
              type: 'object',
              anyOf: [
                { type: 'object', properties: { action: { const: 'run' } }, required: ['action'] },
                { type: 'object', properties: { action: { const: 'stop' } }, required: ['action'] },
              ],
            },
          }],
        }],
      },
    }, { api: 'google-generative-ai' })

    expect(transformed.tagged).toBe(true)
    expect(transformed.config.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual({
      type: 'object',
      properties: { action: { type: 'string', enum: ['run', 'stop'] } },
      required: ['action'],
    })

    // Installing twice must be idempotent (no duplicate streamFunction wrapping)
    const wrappedBefore = fakeSession.agent.streamFunction
    installGoogleToolSchemaSanitizer(fakeSession)
    expect(fakeSession.agent.streamFunction).toBe(wrappedBefore)
  })

  it('flattens root unions with empty properties: {} and nested object unions', () => {
    const flattened = flattenGoogleRootUnionSchema({
      type: 'object',
      properties: {},
      anyOf: [
        {
          type: 'object',
          anyOf: [
            { type: 'object', properties: { kind: { const: 'a' }, url: { type: 'string', format: 'uri' } }, required: ['kind'] },
            { type: 'object', properties: { kind: { const: 'b' }, url: { type: 'string', format: 'uri' } }, required: ['kind'] },
          ],
        },
        {
          type: 'object',
          properties: { kind: { const: 'c' }, url: { type: 'string', format: 'uri' } },
          required: ['kind'],
        },
      ],
    })

    expect(flattened).toEqual({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['a', 'b', 'c'] },
        url: { type: 'string', format: 'uri' },
      },
      required: ['kind'],
    })
  })
})
