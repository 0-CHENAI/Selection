import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { generateProviderImage, imageGenerationBody, normalizeImageProvider, validateImageProvider } from './image-provider'
import { generatePresentationImage } from './ppt-image-generate'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('image provider', () => {
  test('defaults, console URLs and unsafe endpoints', () => {
    expect(normalizeImageProvider('bytedance')).toEqual({ provider: 'bytedance', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-4-5-251128' })
    expect(normalizeImageProvider('openai', { baseUrl: 'https://api.openai.com/v1/images/generations/' }).baseUrl).toBe('https://api.openai.com/v1')
    expect(normalizeImageProvider('openai', { baseUrl: 'http://127.0.0.1:9000/v1' }).baseUrl).toBe('http://127.0.0.1:9000/v1')
    expect(() => normalizeImageProvider('openai', { baseUrl: 'http://example.com/v1' })).toThrow('HTTPS')
    expect(() => normalizeImageProvider('openai', { baseUrl: 'https://u:p@example.com/v1' })).toThrow('HTTPS')
    expect(() => normalizeImageProvider('midjourney')).toThrow('Seedream')
    expect(() => normalizeImageProvider('openai', { model: 'bad model' })).toThrow('模型')
  })

  test('request bodies follow each provider contract', () => {
    const ark = imageGenerationBody(normalizeImageProvider('bytedance'), { prompt: '港口晨景', style_context: '冷静写实，图片内文字数量为 0', aspect_ratio: '16:9', purpose: 'presentation' })
    expect(ark).toMatchObject({ model: 'doubao-seedream-4-5-251128', size: '2560x1440', response_format: 'b64_json', watermark: false })
    expect(String(ark.prompt)).toContain('Art direction: 冷静写实')
    const openai = imageGenerationBody(normalizeImageProvider('openai'), { prompt: 'x', aspect_ratio: '3:4' })
    expect(openai).toMatchObject({ size: '1024x1536', n: 1, output_format: 'png' })
    expect(() => imageGenerationBody(normalizeImageProvider('openai'), { prompt: 'x', aspect_ratio: '2:1' })).toThrow('画幅')
  })

  test('generation decodes b64_json and never echoes the key', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const ok = await generateProviderImage({ provider: 'bytedance', baseUrl: '', model: '', key: 'sk-secret' }, { prompt: 'p', aspect_ratio: '1:1' }, async (url, init) => {
      calls.push({ url, init })
      return json(200, { data: [{ b64_json: PNG.toString('base64') }] })
    })
    expect(calls[0]!.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer sk-secret')
    expect(Buffer.from(ok.bytes).equals(PNG)).toBe(true)
    expect(ok).toMatchObject({ width: 2048, height: 2048, provider: 'bytedance:doubao-seedream-4-5-251128' })

    const denied = generateProviderImage({ provider: 'openai', baseUrl: '', model: '', key: 'sk-secret' }, { prompt: 'p', aspect_ratio: '1:1' }, async () => json(401, { error: { code: 'sk-secret', message: 'bad key sk-secret' } }, { 'x-request-id': 'req_1' }))
    await expect(denied).rejects.toThrow('API Key 无效')
    await expect(denied).rejects.not.toThrow('sk-secret')
    await expect(generateProviderImage({ provider: 'openai', baseUrl: '', model: '', key: 'k' }, { prompt: 'p', aspect_ratio: '1:1' }, async () => json(200, { data: [{}] }))).rejects.toThrow('有效图片')
  })

  test('save-time validation does not generate an image', async () => {
    expect(await validateImageProvider({ provider: 'openai', baseUrl: '', model: 'gpt-image-1.5', key: 'k' }, async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/models/gpt-image-1.5')
      expect(init?.method).toBe('GET')
      return json(200, { id: 'gpt-image-1.5' })
    })).toBe('model')
    expect(await validateImageProvider({ provider: 'bytedance', baseUrl: '', model: '', key: 'k' }, async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'doubao-seedream-4-5-251128' })
      return json(400, { error: { code: 'MissingParameter', message: 'The required parameter prompt is missing', param: 'prompt' } })
    })).toBe('connection')
    await expect(validateImageProvider({ provider: 'bytedance', baseUrl: '', model: '', key: 'k' }, async () => json(403, {}))).rejects.toThrow('权限')
    await expect(validateImageProvider({ provider: 'bytedance', baseUrl: '', model: '', key: ' ' })).rejects.toThrow('API Key')
  })

  test('image_generate uses the saved provider before falling back to a placeholder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'image-provider-'))
    dirs.push(root)
    const original = globalThis.fetch
    globalThis.fetch = (async () => json(200, { data: [{ b64_json: PNG.toString('base64') }] })) as unknown as typeof fetch
    try {
      const result = await generatePresentationImage({
        purpose: 'presentation', aspect_ratio: '16:9', style_context: '图片内文字数量为 0', prompt: '仓库外景',
        workspaceDir: join(root, 'w'), sessionDir: join(root, 's'), configDir: join(root, 'c'),
        providerConfig: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1.5', key: 'k' },
      })
      expect(result).toMatchObject({ status: 'generated', placeholder: false, provider: 'openai:gpt-image-1.5', width: 1536, height: 1024 })
      expect(readFileSync(result.path!).equals(PNG)).toBe(true)
    } finally {
      globalThis.fetch = original
    }
    const fallback = await generatePresentationImage({
      purpose: 'presentation', aspect_ratio: '16:9', style_context: '图片内文字数量为 0', prompt: '另一张',
      workspaceDir: join(root, 'w'), sessionDir: join(root, 's2'), configDir: join(root, 'c'), providerConfig: null,
    })
    expect(fallback).toMatchObject({ status: 'placeholder', placeholder: true })
    expect(fallback.message).toContain('PPT 配图')
  })
})
