import { describe, expect, it } from 'bun:test'
import {
  buildCustomEndpointModelDef,
  findCustomEndpointModelEntry,
  normalizeCustomEndpointModelEntry,
  stripPiPrefix,
} from './custom-endpoint-models.ts'

describe('normalizeCustomEndpointModelEntry', () => {
  it('strips pi/ prefixes from string model IDs', () => {
    expect(stripPiPrefix('pi/my-model')).toBe('my-model')
    expect(normalizeCustomEndpointModelEntry('pi/my-model')).toEqual({ id: 'my-model' })
  })

  it('strips custom-endpoint/ prefixes from runtime IDs', () => {
    expect(stripPiPrefix('custom-endpoint/Opus')).toBe('Opus')
    expect(normalizeCustomEndpointModelEntry('custom-endpoint/Opus')).toEqual({ id: 'Opus' })
  })

  it('preserves per-model image support when enabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      supportsImages: true,
    })
  })

  it('preserves explicit per-model image support when disabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/text-only-model',
      supportsImages: false,
    })).toEqual({
      id: 'text-only-model',
      supportsImages: false,
    })
  })

  it('preserves context window and image support together', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })
  })
})

describe('buildCustomEndpointModelDef', () => {
  it('defaults custom endpoint models to text-only input and 128k/8k limits', () => {
    const model = buildCustomEndpointModelDef('my-model')
    expect(model.input).toEqual(['text'])
    expect(model.contextWindow).toBe(131_072)
    expect(model.maxTokens).toBe(8_192)
  })

  it('enables image input when the connection explicitly opts in', () => {
    const model = buildCustomEndpointModelDef('vision-model', { supportsImages: true })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('lets per-model overrides disable image input even when the connection default is enabled', () => {
    const model = buildCustomEndpointModelDef('text-only-model', { supportsImages: true }, { supportsImages: false })
    expect(model.input).toEqual(['text'])
  })

  it('clamps maxTokens to the context window', () => {
    const oversized = buildCustomEndpointModelDef('tiny-window', undefined, {
      contextWindow: 4_096,
      maxTokens: 65_536,
    })
    expect(oversized.contextWindow).toBe(4_096)
    expect(oversized.maxTokens).toBe(4_096)

    const implicitDefault = buildCustomEndpointModelDef('tiny-window', undefined, {
      contextWindow: 4_096,
    })
    expect(implicitDefault.maxTokens).toBe(4_096)
  })

  it('lets per-model overrides enable image input and custom token limits', () => {
    const model = buildCustomEndpointModelDef('vision-model', undefined, {
      supportsImages: true,
      contextWindow: 262_144,
      maxTokens: 65_536,
    })
    expect(model.input).toEqual(['text', 'image'])
    expect(model.contextWindow).toBe(262_144)
    expect(model.maxTokens).toBe(65_536)
  })

  it('infers image input for well-known vision names when no flag is set', () => {
    const model = buildCustomEndpointModelDef('Opus')
    expect(model.input).toEqual(['text', 'image'])
  })

  it('lets a connection default of false beat the name heuristic', () => {
    const model = buildCustomEndpointModelDef('Opus', { supportsImages: false })
    expect(model.input).toEqual(['text'])
  })
})

describe('findCustomEndpointModelEntry', () => {
  it('preserves supportsImages from the stored catalog when the runtime ID is prefixed', () => {
    expect(findCustomEndpointModelEntry('pi/Opus', [
      { id: 'Opus', supportsImages: true },
    ])).toEqual({
      id: 'Opus',
      supportsImages: true,
    })
  })

  it('does not promote inferred vision onto the catalog entry', () => {
    expect(findCustomEndpointModelEntry('custom-endpoint/Opus', ['Opus'])).toEqual({
      id: 'Opus',
    })
  })

  it('does not invent vision for unknown names', () => {
    expect(findCustomEndpointModelEntry('pi/Laufry', ['Laufry'])).toEqual({
      id: 'Laufry',
    })
  })

  it('preserves stored catalog token limits when the runtime ID is prefixed', () => {
    expect(findCustomEndpointModelEntry('custom-endpoint/DeepSeek-V4-Flash', [
      { id: 'DeepSeek-V4-Flash', contextWindow: 262_144, maxTokens: 65_536 },
    ])).toEqual({
      id: 'DeepSeek-V4-Flash',
      contextWindow: 262_144,
      maxTokens: 65_536,
    })
  })
})
