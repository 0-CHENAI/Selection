import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePresentationImage, IMAGE_GENERATE_LIMIT } from './ppt-image-generate'

const style = 'medium 摄影；palette 纸色；lighting 日光；tone 克制；textTreatment 图片内文字数量为 0；continuity 同一机位'

test('without a provider the slot stays a placeholder and the same reuse group is not generated twice', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ppt-images-'))
  const session = mkdtempSync(join(tmpdir(), 'ppt-image-session-'))
  const config = mkdtempSync(join(tmpdir(), 'ppt-image-config-'))
  try {
    const first = await generatePresentationImage({
      purpose: 'presentation', aspect_ratio: '16:9', style_context: style, prompt: '产品放在浅色桌面上',
      reuse_group: 'product', workspaceDir: workspace, sessionDir: session, configDir: config,
    })
    expect(first.status).toBe('placeholder')
    expect(first.placeholder).toBe(true)
    expect(first.path).toContain('selection-placeholder-')
    expect(first.message).toContain('没有可用的生图提供方')
    const again = await generatePresentationImage({
      purpose: 'presentation', aspect_ratio: '16:9', style_context: style, prompt: '另一句',
      reuse_group: 'product', workspaceDir: workspace, sessionDir: session, configDir: config,
    })
    expect(again.status).toBe('reused')
    expect(again.path).toBe(first.path)
    expect(JSON.parse(readFileSync(join(session, 'data', 'image-generate.json'), 'utf8')).count).toBe(1)
    const portrait = await generatePresentationImage({
      purpose: 'presentation', aspect_ratio: '1:1', style_context: style, prompt: '人物',
      source_policy: 'provided-portrait', workspaceDir: workspace, sessionDir: session, configDir: config,
    })
    expect(portrait.status).toBe('refused')
    expect(portrait.path).toBeUndefined()
  } finally {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(session, { recursive: true, force: true })
    rmSync(config, { recursive: true, force: true })
  }
})

test('a configured generator writes a real file and then stops at the deck limit', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ppt-gen-'))
  const session = mkdtempSync(join(tmpdir(), 'ppt-gen-session-'))
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    let calls = 0
    const generate = async () => {
      calls += 1
      return { bytes: png, provider: 'test', width: 1, height: 1 }
    }
    for (let index = 0; index < IMAGE_GENERATE_LIMIT; index++) {
      const result = await generatePresentationImage({
        purpose: 'presentation', aspect_ratio: '4:3', style_context: style, prompt: `画面 ${index}`,
        reuse_group: `g${index}`, workspaceDir: workspace, sessionDir: session, generate,
      })
      expect(result.status).toBe('generated')
      expect(result.placeholder).toBe(false)
    }
    const blocked = await generatePresentationImage({
      purpose: 'presentation', aspect_ratio: '4:3', style_context: style, prompt: '超出',
      workspaceDir: workspace, sessionDir: session, generate,
    })
    expect(blocked.status).toBe('limit')
    expect(calls).toBe(IMAGE_GENERATE_LIMIT)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(session, { recursive: true, force: true })
  }
})
