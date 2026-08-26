import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import { buildBackendRuntimeSignature, filterAttachmentsForModelInput, prepareModelImageAttachments } from './runtime-config'

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

  it('ignores non-runtime metadata such as lastUsedAt', () => {
    expect(sig({ ...baseCompat, lastUsedAt: 1 })).toBe(sig({ ...baseCompat, lastUsedAt: 2 }))
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
})
