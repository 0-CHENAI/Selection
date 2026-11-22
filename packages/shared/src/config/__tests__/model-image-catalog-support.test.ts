import { describe, expect, it } from 'bun:test'
import { lookupPiCatalogImageSupport } from '../models-pi.ts'
import {
  lookupCatalogImageSupport,
  resolveModelImageSupportFromCatalog,
} from '../model-image-support.ts'

describe('Pi SDK catalog image support', () => {
  it('marks official Kimi K3.1 Pro ids as vision without treating every Kimi id as vision', () => {
    expect(lookupPiCatalogImageSupport('k3.1-pro')).toBe(true)
    expect(lookupPiCatalogImageSupport('pi/k3.1-pro')).toBe(true)
    expect(lookupPiCatalogImageSupport('k3.1-pro-highspeed')).toBe(true)
    expect(lookupPiCatalogImageSupport('kimi-k3.1-pro')).toBe(true)
    expect(lookupPiCatalogImageSupport('pi/kimi-k3.1-pro')).toBe(true)
    expect(lookupPiCatalogImageSupport('kimi-k3.1-pro-highspeed')).toBe(true)
    expect(lookupPiCatalogImageSupport('k3')).toBe(true)
    expect(lookupPiCatalogImageSupport('Maylo')).toBeUndefined()
    expect(lookupCatalogImageSupport('k3.1-pro')).toBe(true)
    expect(resolveModelImageSupportFromCatalog({ modelId: 'pi/k3.1-pro' })).toMatchObject({
      supportsImages: true,
      source: 'catalog',
    })
    expect(resolveModelImageSupportFromCatalog({ modelId: 'brand-new-custom' })).toMatchObject({
      supportsImages: true,
      source: 'optimistic',
    })
  })

  it('keeps official DeepSeek flash as vision and v4-pro as text-only', () => {
    expect(lookupPiCatalogImageSupport('deepseek-flash')).toBe(true)
    expect(lookupPiCatalogImageSupport('deepseek-v4-pro')).toBe(false)
    expect(lookupPiCatalogImageSupport('deepseek-chat')).toBeUndefined()
    expect(resolveModelImageSupportFromCatalog({ modelId: 'pi/deepseek-v4-pro' })).toMatchObject({
      supportsImages: false,
      source: 'catalog',
    })
    expect(resolveModelImageSupportFromCatalog({ modelId: 'pi/deepseek-flash' })).toMatchObject({
      supportsImages: true,
      source: 'catalog',
    })
    expect(resolveModelImageSupportFromCatalog({ modelId: 'pi/deepseek-chat' })).toMatchObject({
      supportsImages: false,
      source: 'known',
    })
  })

  it('lets a custom gateway skip a colliding built-in catalog text-only id', () => {
    expect(lookupPiCatalogImageSupport('o3-mini')).toBe(false)
    expect(resolveModelImageSupportFromCatalog({ modelId: 'pi/o3-mini' })).toMatchObject({
      supportsImages: false,
      source: 'catalog',
    })
    expect(resolveModelImageSupportFromCatalog({
      modelId: 'pi/o3-mini',
      allowCatalogLookup: false,
    })).toMatchObject({
      supportsImages: true,
      source: 'optimistic',
    })
  })
})
