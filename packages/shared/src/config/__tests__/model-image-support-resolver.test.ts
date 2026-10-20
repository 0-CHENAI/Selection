import { describe, expect, it } from 'bun:test'
import {
  buildSkippedImagesNote,
  inferModelSupportsImages,
  isUnsupportedImageInputError,
  learnModelRejectsImages,
  planUnsupportedImageRetry,
  resolveModelImageSupportFromCatalog,
  setModelImageSupport,
  toCustomEndpointModelPayload,
  type ModelImageRecord,
} from '../model-image-support.ts'
import { modelSupportsImages, type LlmConnection } from '../llm-connections.ts'

const PI = {
  slug: 'deepseek',
  name: 'DeepSeek',
  providerType: 'pi' as const,
  authType: 'api_key' as const,
  createdAt: 1,
}

type ImageConnection = {
  models?: Array<string | ModelImageRecord>
  customEndpoint?: { api?: string; supportsImages?: boolean }
}

function resolution(connection: ImageConnection, modelId: string) {
  return resolveModelImageSupportFromCatalog({
    modelId,
    models: connection.models,
    endpointSupportsImages: connection.customEndpoint?.supportsImages,
  })
}

describe('resolveModelImageSupportFromCatalog precedence', () => {
  it('treats DeepSeek flash as known vision and the other official ids as text-only', () => {
    const conn = {
      ...PI,
      models: ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    }
    expect(resolution(conn, 'pi/deepseek-flash')).toMatchObject({ supportsImages: true, source: 'known', learnable: true })
    expect(resolution(conn, 'deepseek-v4-flash')).toMatchObject({ supportsImages: true, source: 'known' })
    expect(resolution(conn, 'pi/deepseek-v4-pro')).toMatchObject({ supportsImages: false, source: 'known', learnable: false })
    expect(resolution(conn, 'deepseek-chat')).toMatchObject({ supportsImages: false, source: 'known' })
    expect(resolution(conn, 'deepseek-v4-reasoner')).toMatchObject({ supportsImages: false, source: 'known' })
    expect(resolution(conn, 'Laufry')).toMatchObject({ supportsImages: true, source: 'known' })
  })

  it('tries an unknown model and does not treat lookalike names as known vision', () => {
    const conn = { ...PI, models: ['Maylo', 'octopus', 'omnibox', 'foo-vllm'] }
    expect(resolution(conn, 'Maylo')).toMatchObject({ supportsImages: true, source: 'optimistic', learnable: true })
    expect(inferModelSupportsImages('octopus')).toBe(false)
    expect(inferModelSupportsImages('omnibox')).toBe(false)
    expect(inferModelSupportsImages('foo-vllm')).toBe(false)
    expect(resolution(conn, 'octopus').source).toBe('optimistic')
  })

  it('lets explicit on/off beat learned, endpoint, and the known table', () => {
    const off = {
      ...PI,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: [{ id: 'deepseek-flash', imageSupport: 'off' as const, learnedSupportsImages: true, supportsImages: false }],
    }
    expect(resolution(off, 'pi/deepseek-flash')).toMatchObject({
      supportsImages: false, mode: 'off', source: 'explicit', learnable: false,
    })

    const on = {
      ...PI,
      models: [{ id: 'deepseek-chat', imageSupport: 'on' as const, learnedSupportsImages: false }],
    }
    expect(resolution(on, 'deepseek-chat')).toMatchObject({
      supportsImages: true, mode: 'on', source: 'explicit', learnable: false,
    })
  })

  it('lets a learned rejection beat the known vision table', () => {
    const conn = {
      ...PI,
      models: [{ id: 'deepseek-flash', imageSupport: 'auto' as const, learnedSupportsImages: false }],
    }
    expect(resolution(conn, 'pi/deepseek-flash')).toMatchObject({
      supportsImages: false, mode: 'auto', source: 'learned', learnable: false,
    })
  })

  it('lets the endpoint default beat the known table and stay learnable when it allows images', () => {
    const blocked = {
      ...PI,
      customEndpoint: { api: 'openai-completions', supportsImages: false },
      models: ['Opus'],
    }
    expect(resolution(blocked, 'pi/Opus')).toMatchObject({ supportsImages: false, source: 'endpoint', learnable: false })

    const allowed = {
      ...PI,
      customEndpoint: { api: 'openai-completions', supportsImages: true },
      models: ['deepseek-chat'],
    }
    expect(resolution(allowed, 'deepseek-chat')).toMatchObject({ supportsImages: true, source: 'endpoint', learnable: true })
  })

  it('reads a legacy boolean as an explicit choice', () => {
    const conn = { ...PI, models: [{ id: 'custom', supportsImages: false }] }
    expect(resolution(conn, 'custom').source).toBe('explicit')
    expect(resolution(conn, 'custom').supportsImages).toBe(false)
  })
})

describe('unsupported image retry', () => {
  const base = {
    message: 'look at this',
    imageCount: 2,
    toolsStarted: false,
    alreadyRetried: false,
    learnable: true,
  }

  it('detects image-capability rejections and ignores other failures', () => {
    expect(isUnsupportedImageInputError('400 image_url is not supported by this model')).toBe(true)
    expect(isUnsupportedImageInputError('The model does not support image input')).toBe(true)
    expect(isUnsupportedImageInputError('content type image_url is not allowed')).toBe(true)
    expect(isUnsupportedImageInputError('vision is not enabled for this model')).toBe(true)
    expect(isUnsupportedImageInputError('multimodal content is unsupported')).toBe(true)
    expect(isUnsupportedImageInputError('该模型不支持图片输入')).toBe(true)
    expect(isUnsupportedImageInputError('400 bad request')).toBe(false)
    expect(isUnsupportedImageInputError('unsupported image format')).toBe(false)
    expect(isUnsupportedImageInputError('failed to decode image')).toBe(false)
    expect(isUnsupportedImageInputError('image_bytes_unavailable')).toBe(false)
    expect(isUnsupportedImageInputError('image_unsupported_format')).toBe(false)
    expect(isUnsupportedImageInputError('model does not support tools')).toBe(false)
  })

  it('plans one text-only retry and refuses once tools have started or the choice is explicit', () => {
    const plan = planUnsupportedImageRetry({ ...base, error: '400 image input is not supported' })
    expect(plan?.learn).toBe(true)
    expect(plan?.message).toContain(buildSkippedImagesNote(2))
    expect(plan?.message.startsWith('look at this')).toBe(true)

    expect(planUnsupportedImageRetry({ ...base, toolsStarted: true, error: 'image_url unsupported' })).toBeNull()
    expect(planUnsupportedImageRetry({ ...base, alreadyRetried: true, error: 'image_url unsupported' })).toBeNull()
    expect(planUnsupportedImageRetry({ ...base, imageCount: 0, error: 'image_url unsupported' })).toBeNull()
    expect(planUnsupportedImageRetry({ ...base, learnable: false, error: 'image_url unsupported' })).toBeNull()
    expect(planUnsupportedImageRetry({ ...base, error: '429 rate limit' })).toBeNull()
  })

  it('remembers the rejection and does not retry the next turn', () => {
    const plan = planUnsupportedImageRetry({ ...base, error: 'vision unsupported' })
    expect(plan).not.toBeNull()
    const learned = learnModelRejectsImages(
      { models: [{ id: 'pi/deepseek-flash' }] },
      'deepseek-flash',
    )
    expect(learned.models?.[0]).toMatchObject({ imageSupport: 'auto', learnedSupportsImages: false })
    expect(learned.models?.[0]).not.toHaveProperty('supportsImages')
    const next = resolution(learned, 'pi/deepseek-flash')
    expect(next).toMatchObject({ supportsImages: false, source: 'learned', learnable: false })
    expect(planUnsupportedImageRetry({
      ...base,
      learnable: next.learnable,
      error: 'vision unsupported',
    })).toBeNull()
  })

  it('does not overwrite an explicit choice and can reset a learned off back to auto', () => {
    const explicit = { models: [{ id: 'm', imageSupport: 'on' as const, supportsImages: true }] }
    expect(learnModelRejectsImages(explicit, 'm')).toBe(explicit)

    const learned = learnModelRejectsImages({ models: ['m'] }, 'pi/m')
    const reset = setModelImageSupport(learned, 'm', 'auto')
    expect(reset.models?.[0] as unknown).toEqual({ id: 'm', name: 'm', imageSupport: 'auto' })
    expect(resolution(reset, 'm').source).toBe('optimistic')
  })
})

describe('renderer and runtime agree', () => {
  function agree(connection: ImageConnection, modelId: string) {
    const renderer = modelSupportsImages(connection as LlmConnection, modelId)
    const payload = connection.models?.map((model) => toCustomEndpointModelPayload(model))
    const runtime = resolveModelImageSupportFromCatalog({
      modelId,
      models: payload,
      endpointSupportsImages: connection.customEndpoint?.supportsImages,
    })
    expect(runtime.supportsImages).toBe(renderer)
    return runtime
  }

  it('matches for DeepSeek, unknown models, explicit off, and learned off', () => {
    expect(agree({ ...PI, models: [{ id: 'pi/deepseek-flash' }] }, 'pi/deepseek-flash').source).toBe('known')
    expect(agree({ ...PI, models: [{ id: 'deepseek-v4-pro' }] }, 'pi/deepseek-v4-pro').supportsImages).toBe(false)
    expect(agree({ ...PI, models: [{ id: 'brand-new' }] }, 'brand-new').source).toBe('optimistic')
    expect(agree({
      ...PI,
      models: [{ id: 'deepseek-flash', supportsImages: false, imageSupport: 'off' }],
    }, 'pi/deepseek-flash').source).toBe('explicit')
    expect(agree({
      ...PI,
      models: [{ id: 'deepseek-flash', imageSupport: 'auto', learnedSupportsImages: false }],
    }, 'deepseek-flash').source).toBe('learned')
    expect(agree({
      ...PI,
      customEndpoint: { api: 'openai-completions', supportsImages: false },
      models: ['Opus'],
    }, 'pi/Opus').supportsImages).toBe(false)
  })
})
