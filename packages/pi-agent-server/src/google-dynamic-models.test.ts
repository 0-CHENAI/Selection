import { describe, expect, it } from 'bun:test'
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai'
import { resolveGoogleThinkingLevel, usesGoogleThinkingLevel } from '@earendil-works/pi-ai/api/google-shared'
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { withGoogleModels } from '../../shared/src/config/google-catalog.ts'
import type { CustomEndpointModelPayload } from '../../shared/src/config/model-image-support.ts'
import { resolvePiModel } from './model-resolution.ts'

describe('withGoogleModels dynamic native registration', () => {
  it('resolves live Gemini 4 models not in Pi 1.5.0 snapshot via native google-generative-ai transport', async () => {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
      modelsPath: null,
      allowModelNetwork: false,
    })

    let configured: CustomEndpointModelPayload[] | undefined = [
      {
        id: 'pi/gemini-4-neon',
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        supportedThinkingLevels: ['low', 'medium', 'high', 'xhigh'],
        thinkingMode: 'levels',
      },
      {
        id: 'pi/gemini-4-carbon',
        contextWindow: 1_048_576,
        maxTokens: 65_536,
      },
    ]

    const googleProvider = runtime.getProvider('google')!
    runtime.registerNativeProvider(withGoogleModels(googleProvider, () => configured))
    const registry = new ModelRegistry(runtime)

    // Bundled models remain available alongside live models
    expect(resolvePiModel(registry, 'pi/gemini-4-argon', 'google')?.api).toBe('google-generative-ai')
    expect(resolvePiModel(registry, 'pi/gemini-3.8-flash', 'google')?.api).toBe('google-generative-ai')

    // Newly discovered Gemini 4 models resolve on the native google provider
    const neon = resolvePiModel(registry, 'pi/gemini-4-neon', 'google')
    expect(neon).toBeDefined()
    expect(neon!.provider).toBe('google')
    expect(neon!.api).toBe('google-generative-ai')
    expect(neon!.contextWindow).toBe(1_048_576)
    expect(neon!.maxTokens).toBe(65_536)
    expect(neon!.input).toContain('image')
    expect(usesGoogleThinkingLevel(neon!)).toBe(true)
    // xhigh is clamped out for pi-ai 1.5.0's google-shared adapter; low/medium/high work
    expect((neon!.thinkingLevelMap as Record<string, string | null> | undefined)?.xhigh).toBeNull()
    expect((neon!.thinkingLevelMap as Record<string, string | null> | undefined)?.off).toBeNull()
    expect(resolveGoogleThinkingLevel(neon!, 'high')).toBe('high')
    expect(resolveGoogleThinkingLevel(neon!, 'low')).toBe('low')

    // Lazily sees models added after a runtime config update
    expect(resolvePiModel(registry, 'pi/gemini-4-hydrogen', 'google')).toBeUndefined()
    configured = [
      ...configured,
      'pi/gemini-4-hydrogen',
      {
        id: 'pi/gemini-4-plain',
        thinkingMode: 'unsupported',
        supportsImages: false,
      },
      {
        id: 'pi/gemini-4-argon',
        maxTokens: 65_536,
        supportsImages: false,
      },
    ]
    const hydrogen = resolvePiModel(registry, 'pi/gemini-4-hydrogen', 'google')
    expect(hydrogen?.provider).toBe('google')
    expect(hydrogen?.api).toBe('google-generative-ai')

    // Non-thinking dynamic model must not inherit transport's thinkingLevelMap
    const plain = resolvePiModel(registry, 'pi/gemini-4-plain', 'google')
    expect(plain?.reasoning).toBe(false)
    expect(plain?.thinkingLevelMap).toBeUndefined()
    expect(plain?.input).toEqual(['text'])

    // Built-in Google model respects live maxTokens / image overrides while preserving metadata
    const argon = resolvePiModel(registry, 'pi/gemini-4-argon', 'google')
    expect(argon?.name).toBe('Gemini 4 Argon')
    expect(argon?.maxTokens).toBe(65_536)
    expect(argon?.input).toEqual(['text'])
    expect(argon?.cost.input).toBeGreaterThan(0)
  })
})
