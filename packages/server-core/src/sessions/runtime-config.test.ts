import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import '../../../shared/src/config/models-pi.ts'
import { uniquePng } from '../../../shared/src/config/__tests__/vision-image-fixtures.ts'
import { buildBackendRuntimeSignature, buildRestartRequiredSignature, filterAttachmentsForModelInput, prepareModelImageAttachments, usesStreamingAnswerDelivery } from './runtime-config'

const baseCompat: LlmConnection = {
  slug: 'local',
  name: 'Local',
  providerType: 'pi_compat',
  authType: 'none',
  createdAt: 1,
  baseUrl: 'http://127.0.0.1:1234/v1',
  defaultModel: 'gemma',
  piAuthProvider: 'openai',
  customEndpoint: { api: 'openai-completions', supportsImages: true },
  models: [{ id: 'gemma', supportsImages: true } as never],
}

function sig(connection: LlmConnection) {
  return buildBackendRuntimeSignature({
    connection,
    provider: 'pi',
    authType: 'api_key',
    resolvedModel: 'gemma',
  })
}

const imageAttachment: FileAttachment = {
  type: 'image',
  path: '/tmp/image.png',
  name: 'image.png',
  mimeType: 'image/png',
  size: 123,
  base64: 'abc',
}

const textAttachment: FileAttachment = {
  type: 'text',
  path: '/tmp/note.txt',
  name: 'note.txt',
  mimeType: 'text/plain',
  size: 12,
  text: 'hello',
}

describe('buildBackendRuntimeSignature', () => {
  it('changes when a custom endpoint model context window changes', () => {
    const withoutWindow = sig(baseCompat)
    const withWindow = sig({
      ...baseCompat,
      models: [{ id: 'gemma', supportsImages: true, contextWindow: 262_144 } as never],
    })

    expect(withWindow).not.toBe(withoutWindow)
  })

  it('changes when a custom endpoint model maxTokens changes', () => {
    const withoutMax = sig(baseCompat)
    const withMax = sig({
      ...baseCompat,
      models: [{ id: 'gemma', supportsImages: true, maxTokens: 32_768 } as never],
    })

    expect(withMax).not.toBe(withoutMax)
  })

  it('changes when a custom endpoint model image override changes', () => {
    const enabled = sig(baseCompat)
    const disabled = sig({
      ...baseCompat,
      models: [{ id: 'gemma', supportsImages: false } as never],
    })

    expect(disabled).not.toBe(enabled)
  })

  it('updates a running ChatGPT session when its account catalog or reasoning capabilities change', () => {
    const account: LlmConnection = { slug: 'chat', name: 'Chat', providerType: 'pi',
      authType: 'oauth', piAuthProvider: 'openai-codex', createdAt: 1, models: ['pi/new'] }
    expect(sig(account)).not.toBe(sig({ ...account, models: [] }))
    expect(sig({ ...account, models: undefined })).not.toBe(sig({ ...account, models: [] }))
    expect(sig(account)).not.toBe(sig({ ...account, models: [{ id: 'pi/new', thinkingMode: 'unsupported' } as never] }))
    expect(sig(account)).toBe(sig({ ...account, chatgptCatalogFetchedAt: 100 }))
  })

  it('ignores non-runtime metadata such as lastUsedAt', () => {
    expect(sig({ ...baseCompat, lastUsedAt: 1 })).toBe(sig({ ...baseCompat, lastUsedAt: 2 }))
  })
})

describe('answer delivery mode', () => {
  it('uses structured delivery for marker-v1 connections and native streaming for other streaming connections', () => {
    expect(usesStreamingAnswerDelivery({ answerDelivery: 'streaming', presentationProtocol: 'marker-v1' })).toBe(false)
    expect(usesStreamingAnswerDelivery({ answerDelivery: 'streaming', presentationProtocol: 'native' })).toBe(true)
    expect(usesStreamingAnswerDelivery({ answerDelivery: 'streaming', presentationProtocol: 'legacy' })).toBe(true)
    expect(usesStreamingAnswerDelivery({ answerDelivery: 'tool' })).toBe(false)
  })

  it('restarts an existing agent when the effective delivery mode changes', () => {
    const signature = (connection: LlmConnection) => buildRestartRequiredSignature({
      connection, provider: 'pi', authType: 'api_key', resolvedModel: 'gemma',
    })
    expect(signature({ ...baseCompat, answerDelivery: 'streaming', presentationProtocol: 'marker-v1' }))
      .toBe(signature({ ...baseCompat, answerDelivery: 'tool' }))
    expect(signature({ ...baseCompat, answerDelivery: 'streaming', presentationProtocol: 'native' }))
      .not.toBe(signature({ ...baseCompat, answerDelivery: 'tool' }))
  })
})

describe('filterAttachmentsForModelInput', () => {
  it('omits images for pi_compat text-only models while preserving other attachments', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment, textAttachment],
      { ...baseCompat, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages.map(a => a.name)).toEqual(['image.png'])
    expect(result.attachments?.map(a => a.name)).toEqual(['note.txt'])
  })

  it('keeps images when the per-model override enables images', () => {
    const result = filterAttachmentsForModelInput([imageAttachment], baseCompat, 'gemma')

    expect(result.omittedImages).toHaveLength(0)
    expect(result.attachments).toEqual([imageAttachment])
  })

  it('treats explicit supportsImages=false as overriding endpoint-level true', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment],
      { ...baseCompat, customEndpoint: { api: 'openai-completions', supportsImages: true }, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages).toEqual([imageAttachment])
    expect(result.attachments).toBeUndefined()
  })

  it('keeps images when the runtime model ID is prefixed but the stored ID matches', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment],
      { ...baseCompat, models: [{ id: 'Opus', supportsImages: true } as never] },
      'pi/Opus',
    )

    expect(result.omittedImages).toHaveLength(0)
    expect(result.attachments).toEqual([imageAttachment])
  })

  it('omits images before hydrate for an explicit text-only model', () => {
    const pathOnlyImage: FileAttachment = {
      type: 'image',
      path: '/tmp/missing.png',
      name: 'missing.png',
      mimeType: 'image/png',
      size: 1,
    }
    const result = filterAttachmentsForModelInput(
      [pathOnlyImage],
      { ...baseCompat, models: [{ id: 'Opus', supportsImages: false } as never] },
      'pi/Opus',
    )
    expect(result.omittedImages).toEqual([pathOnlyImage])
    expect(result.attachments).toBeUndefined()
  })

  it('soft-skips a known text-only model and still returns the other attachments', () => {
    const connection: LlmConnection = {
      slug: 'deepseek',
      name: 'DeepSeek',
      providerType: 'pi',
      authType: 'api_key',
      createdAt: 1,
      models: [{ id: 'deepseek-v4-pro' } as never],
    }
    const result = filterAttachmentsForModelInput(
      [imageAttachment, textAttachment],
      connection,
      'pi/deepseek-v4-pro',
    )
    expect(result.resolution?.source === 'known' || result.resolution?.source === 'catalog').toBe(true)
    expect(result.omittedImages).toEqual([imageAttachment])
    expect(result.attachments).toEqual([textAttachment])
  })
})

describe('prepareModelImageAttachments', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function writeShot(): { path: string; bytes: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), 'image-prepare-'))
    roots.push(dir)
    const path = join(dir, 'shot.png')
    const bytes = Buffer.from('stable-png-bytes')
    writeFileSync(path, bytes)
    return { path, bytes }
  }

  it('hydrates stored images and reports stable diagnostics without raw bytes', () => {
    const { path, bytes } = writeShot()
    const first = prepareModelImageAttachments({
      storedAttachments: [{
        type: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        size: bytes.byteLength,
        storedPath: path,
      }],
      connection: baseCompat,
      modelId: 'gemma',
    })

    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.payloadImageCount).toBe(1)
    expect(first.attachments?.[0]?.base64).toBe(bytes.toString('base64'))
    expect(first.diagnostics[0]?.hasBytes).toBe(true)
    expect(JSON.stringify(first.diagnostics)).not.toContain(bytes.toString('base64'))

    for (let i = 0; i < 20; i++) {
      const again = prepareModelImageAttachments({
        storedAttachments: [{
          type: 'image',
          name: 'shot.png',
          mimeType: 'image/png',
          size: bytes.byteLength,
          storedPath: path,
        }],
        connection: baseCompat,
        modelId: 'gemma',
      })
      expect(again).toEqual(first)
    }
  })

  it('blocks text-only models instead of silently dropping images', () => {
    const result = prepareModelImageAttachments({
      attachments: [imageAttachment],
      connection: { ...baseCompat, models: [{ id: 'gemma', supportsImages: false } as never] },
      modelId: 'gemma',
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'image_capability_mismatch',
      payloadImageCount: 0,
    })
  })

  it('skips known text-only images without failing the turn', () => {
    const result = prepareModelImageAttachments({
      attachments: [imageAttachment, textAttachment],
      connection: {
        slug: 'deepseek',
        name: 'DeepSeek',
        providerType: 'pi',
        authType: 'api_key',
        createdAt: 1,
        models: [{ id: 'pi/deepseek-chat' } as never],
      },
      modelId: 'deepseek-chat',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payloadImageCount).toBe(0)
    expect(result.skippedImages).toEqual([imageAttachment])
    expect(result.attachments).toEqual([textAttachment])
  })

  it('hydrates live path-only attachments from storedPath metadata', () => {
    const { path, bytes } = writeShot()
    const result = prepareModelImageAttachments({
      attachments: [{
        type: 'image',
        path: join(tmpdir(), 'clipboard-original.png'),
        name: 'shot.png',
        mimeType: 'image/png',
        size: bytes.byteLength,
      }],
      storedAttachments: [{
        type: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        size: bytes.byteLength,
        storedPath: path,
      }],
      connection: baseCompat,
      modelId: 'gemma',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.attachments?.[0]?.base64).toBe(bytes.toString('base64'))
  })

  it('blocks missing stored files as resource_expired', () => {
    const result = prepareModelImageAttachments({
      storedAttachments: [{
        type: 'image',
        name: 'gone.png',
        mimeType: 'image/png',
        size: 12,
        storedPath: join(tmpdir(), 'missing-image-input.png'),
      }],
      connection: baseCompat,
      modelId: 'gemma',
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'image_resource_expired',
      payloadImageCount: 0,
    })
  })

  it('sends Kimi K3.1 Pro images and restores the same sha256 after persistence', () => {
    const bytes = uniquePng('kimi-k3.1-pro-restore')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const dir = mkdtempSync(join(tmpdir(), 'image-kimi-'))
    roots.push(dir)
    const path = join(dir, 'shot.png')
    writeFileSync(path, bytes)

    const kimi: LlmConnection = {
      slug: 'kimi-coding',
      name: 'Kimi Code',
      providerType: 'pi',
      authType: 'api_key',
      createdAt: 1,
      piAuthProvider: 'kimi-coding',
      models: ['pi/k3.1-pro'],
    }
    const restored = prepareModelImageAttachments({
      storedAttachments: [{
        type: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        size: bytes.byteLength,
        storedPath: path,
      }],
      connection: kimi,
      modelId: 'pi/k3.1-pro',
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.payloadImageCount).toBe(1)
    expect(restored.attachments?.[0]?.base64).toBe(bytes.toString('base64'))
    expect(createHash('sha256').update(Buffer.from(restored.attachments?.[0]?.base64 ?? '', 'base64')).digest('hex')).toBe(sha256)
  })

  it('keeps multi-image order for vision models and skips both for catalog text-only', () => {
    const first = uniquePng('multi-a')
    const second = uniquePng('multi-b')
    const dir = mkdtempSync(join(tmpdir(), 'image-multi-'))
    roots.push(dir)
    const pathA = join(dir, 'a.png')
    const pathB = join(dir, 'b.png')
    writeFileSync(pathA, first)
    writeFileSync(pathB, second)
    const attachments: FileAttachment[] = [
      { type: 'image', path: pathA, name: 'a.png', mimeType: 'image/png', size: first.byteLength },
      { type: 'image', path: pathB, name: 'b.png', mimeType: 'image/png', size: second.byteLength },
    ]
    const storedAttachments = [
      { type: 'image' as const, name: 'a.png', mimeType: 'image/png', size: first.byteLength, storedPath: pathA },
      { type: 'image' as const, name: 'b.png', mimeType: 'image/png', size: second.byteLength, storedPath: pathB },
    ]

    const vision = prepareModelImageAttachments({
      attachments,
      storedAttachments,
      connection: {
        slug: 'kimi-coding',
        name: 'Kimi Code',
        providerType: 'pi',
        authType: 'api_key',
        createdAt: 1,
        models: ['pi/k3.1-pro'],
      },
      modelId: 'k3.1-pro',
    })
    expect(vision.ok).toBe(true)
    if (!vision.ok) return
    expect(vision.payloadImageCount).toBe(2)
    expect(vision.attachments?.map(item => item.name)).toEqual(['a.png', 'b.png'])
    expect(vision.attachments?.[0]?.base64).toBe(first.toString('base64'))
    expect(vision.attachments?.[1]?.base64).toBe(second.toString('base64'))

    const skipped = prepareModelImageAttachments({
      attachments,
      storedAttachments,
      connection: {
        slug: 'deepseek',
        name: 'DeepSeek',
        providerType: 'pi',
        authType: 'api_key',
        createdAt: 1,
        models: ['pi/deepseek-chat'],
      },
      modelId: 'deepseek-chat',
    })
    expect(skipped.ok).toBe(true)
    if (!skipped.ok) return
    expect(skipped.payloadImageCount).toBe(0)
    expect(skipped.skippedImages?.map(item => item.name)).toEqual(['a.png', 'b.png'])
  })

  it('tries unknown custom models and refuses explicit off', () => {
    const unknown = prepareModelImageAttachments({
      attachments: [imageAttachment],
      connection: {
        slug: 'custom',
        name: 'Custom',
        providerType: 'pi_compat',
        authType: 'api_key_with_endpoint',
        createdAt: 1,
        baseUrl: 'http://127.0.0.1:9/v1',
        customEndpoint: { api: 'openai-completions' },
        models: ['Maylo'],
      },
      modelId: 'Maylo',
    })
    expect(unknown.ok).toBe(true)
    if (!unknown.ok) return
    expect(unknown.payloadImageCount).toBe(1)

    const filtered = filterAttachmentsForModelInput(
      [imageAttachment],
      { ...baseCompat, models: [{ id: 'Maylo', imageSupport: 'off' } as never] },
      'Maylo',
    )
    expect(filtered.resolution?.source).toBe('explicit')
    expect(filtered.omittedImages).toEqual([imageAttachment])
  })
})
