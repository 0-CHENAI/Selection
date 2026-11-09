import { describe, expect, it } from 'bun:test'
import {
  bedrockModelFieldMode,
  buildCustomEndpointModelSubmission,
  orderModelFieldMode,
  resolveCustomEndpointPayload,
  shouldAutoProbeModelCatalog,
  showCustomFormatPicker,
  showsEndpointModelLimits,
  resolvePiAuthProviderForSubmit,
  resolvePresetStateForBaseUrlChange,
} from '../submit-helpers'
import { pickTierDefaults, resolveTierModels } from '../tier-models'

const MODELS = [
  { id: 'pi/zai-best', name: 'Best', costInput: 10, costOutput: 20, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-balanced', name: 'Balanced', costInput: 5, costOutput: 10, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-fast', name: 'Fast', costInput: 1, costOutput: 2, contextWindow: 128000, reasoning: false },
]

describe('ApiKeyInput tier hydration helpers', () => {
  it('resolveTierModels keeps saved tier selections when all are valid', () => {
    const saved = ['pi/zai-fast', 'pi/zai-balanced', 'pi/zai-best']
    const resolved = resolveTierModels(MODELS, saved)

    expect(resolved).toEqual({
      best: 'pi/zai-fast',
      default_: 'pi/zai-balanced',
      cheap: 'pi/zai-best',
    })
  })

  it('resolveTierModels preserves duplicate tiers when saved models are valid', () => {
    const saved = ['pi/zai-best', 'pi/zai-best', 'pi/zai-fast']
    const resolved = resolveTierModels(MODELS, saved)

    expect(resolved).toEqual({
      best: 'pi/zai-best',
      default_: 'pi/zai-best',
      cheap: 'pi/zai-fast',
    })
  })

  it('resolveTierModels falls back per-slot for invalid/missing saved values', () => {
    const resolved = resolveTierModels(MODELS, ['pi/zai-best', 'pi/not-real'])
    const defaults = pickTierDefaults(MODELS)

    expect(resolved).toEqual({
      best: 'pi/zai-best',
      default_: defaults.default_,
      cheap: defaults.cheap,
    })
  })
})

describe('resolvePiAuthProviderForSubmit', () => {
  it('preserves the last non-custom provider when custom endpoint mode is selected', () => {
    expect(resolvePiAuthProviderForSubmit('custom', 'openai')).toBe('openai')
  })

  it('defaults custom endpoint mode to openai routing when none was selected yet', () => {
    expect(resolvePiAuthProviderForSubmit('custom', null)).toBe('openai')
  })

  it('passes through non-custom presets unchanged', () => {
    expect(resolvePiAuthProviderForSubmit('google', 'openai')).toBe('google')
  })
})

describe('resolvePresetStateForBaseUrlChange', () => {
  it('keeps Custom when the typed URL matches a known preset', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'kimi-coding',
      activePreset: 'custom',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'openai',
    })).toEqual({
      activePreset: 'custom',
      lastNonCustomPreset: 'openai',
    })
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'openrouter',
      activePreset: 'custom',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'openai',
    })).toEqual({
      activePreset: 'custom',
      lastNonCustomPreset: 'openai',
    })
  })

  it('switches a non-custom preset when the typed URL matches another known preset', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'openrouter',
      activePreset: 'azure-openai-responses',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'azure-openai-responses',
    })).toEqual({
      activePreset: 'openrouter',
      lastNonCustomPreset: 'openrouter',
    })
  })

  it('preserves provider routing when editing a provider with an empty default URL', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'custom',
      activePreset: 'azure-openai-responses',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'azure-openai-responses',
    })).toEqual({
      activePreset: 'azure-openai-responses',
      lastNonCustomPreset: 'azure-openai-responses',
    })
  })

  it('falls back to custom while keeping the most recent matched provider', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'custom',
      activePreset: 'openrouter',
      activePresetHasEmptyUrl: false,
      lastNonCustomPreset: 'openrouter',
    })).toEqual({
      activePreset: 'custom',
      lastNonCustomPreset: 'openrouter',
    })
  })
})

describe('ORDER and Bedrock model fields', () => {
  it('keeps ORDER on the checkbox list until a fetch with a real key fails', () => {
    expect(orderModelFieldMode({ remoteModelsLoading: false, remoteModelCount: 0, apiKeyLength: 3 })).toBe('picker')
    expect(orderModelFieldMode({ remoteModelsLoading: true, remoteModelCount: 0, apiKeyLength: 20 })).toBe('picker')
    expect(orderModelFieldMode({ remoteModelsLoading: false, remoteModelCount: 4, apiKeyLength: 20 })).toBe('picker')
    expect(orderModelFieldMode({ remoteModelsLoading: false, remoteModelCount: 0, apiKeyLength: 20 })).toBe('manual')
  })

  it('shows context length once an ORDER model is selected', () => {
    expect(showsEndpointModelLimits({
      isCustomEndpointForm: true,
      isBedrock: false,
      selectedModelCount: 2,
    })).toBe(true)
    expect(showsEndpointModelLimits({
      isCustomEndpointForm: true,
      isBedrock: false,
      selectedModelCount: 0,
    })).toBe(false)
    expect(showsEndpointModelLimits({
      isCustomEndpointForm: false,
      isBedrock: true,
      selectedModelCount: 2,
    })).toBe(false)
  })

  it('uses the Bedrock checkbox catalog when models can be listed', () => {
    expect(bedrockModelFieldMode({ loading: true, catalogCount: 0 })).toBe('picker')
    expect(bedrockModelFieldMode({ loading: false, catalogCount: 12 })).toBe('picker')
    expect(bedrockModelFieldMode({ loading: false, catalogCount: 0 })).toBe('manual')
  })
})

describe('shouldAutoProbeModelCatalog', () => {
  it('waits for the Fetch models button on a custom endpoint', () => {
    expect(shouldAutoProbeModelCatalog('custom', 'openai-completions')).toBe(false)
    expect(shouldAutoProbeModelCatalog('custom', 'anthropic-messages')).toBe(false)
  })

  it('still probes branded OpenAI presets and skips Anthropic Messages', () => {
    expect(shouldAutoProbeModelCatalog('order-openai', 'openai-completions')).toBe(true)
    expect(shouldAutoProbeModelCatalog('manifest', 'anthropic-messages')).toBe(false)
  })
})

describe('showCustomFormatPicker', () => {
  it('shows OpenAI and Anthropic format buttons for a custom endpoint before a URL is entered', () => {
    expect(showCustomFormatPicker('custom')).toBe(true)
    expect(showCustomFormatPicker('manifest')).toBe(false)
    expect(showCustomFormatPicker('order-openai')).toBe(false)
    expect(showCustomFormatPicker('kimi-coding')).toBe(false)
  })
})

describe('resolveCustomEndpointPayload', () => {
  const BRANDED = new Set(['manifest'])

  it('routes branded openai-compat presets through openai-completions regardless of toggle', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: 'https://app.manifest.build/v1',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })
  })

  it('uses the button the user pressed and does not infer the format from the URL', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'custom',
      baseUrl: 'https://api.anthropic.com',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })
    expect(resolveCustomEndpointPayload({
      activePreset: 'custom',
      baseUrl: 'https://api.kimi.com/coding/',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
    })
  })

  it('keeps Anthropic Messages for the generic custom preset', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'custom',
      baseUrl: 'https://my-endpoint.example.com',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
    })
  })

  it('returns no customEndpoint for a standard preset, passing through the fallback piAuth', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: 'openrouter',
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: 'openrouter',
    })
  })

  it('treats branded preset with empty URL as non-custom (no customEndpoint)', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: '',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: undefined,
    })
  })

  it('does not create a custom endpoint for leftover ORDER Anthropic presets', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'order-anthropic',
      baseUrl: 'https://order.ai.jxepdi.top',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      brandedAnthropicCompatPresets: new Set(['order-anthropic']),
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: undefined,
    })
  })

  it('routes ORDER OpenAI preset to openai-completions', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'order-openai',
      baseUrl: 'https://order.ai.jxepdi.top/v1',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: new Set(['manifest', 'order-openai']),
      brandedAnthropicCompatPresets: new Set(['order-anthropic']),
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })
  })
})

describe('buildCustomEndpointModelSubmission', () => {
  it('persists an explicit multimodal setting for every custom endpoint', () => {
    expect(buildCustomEndpointModelSubmission({
      id: 'private-model',
      supportsImages: true,
      contextWindow: 262_144,
      maxTokens: 131_072,
    })).toEqual({
      id: 'private-model',
      supportsImages: true,
      contextWindow: 262_144,
      maxTokens: 131_072,
    })
  })

  it('keeps ORDER catalog names without changing the capability payload', () => {
    expect(buildCustomEndpointModelSubmission({
      id: 'Opus',
      name: 'Opus 4.8',
      includeDisplayNames: true,
      supportsImages: false,
      contextWindow: 524_288,
      maxTokens: 262_144,
    })).toEqual({
      id: 'Opus',
      name: 'Opus 4.8',
      shortName: 'Opus 4.8',
      supportsImages: false,
      contextWindow: 524_288,
      maxTokens: 262_144,
    })
  })
})


it('persists explicit supported reasoning levels with an exact context limit', () => {
  expect(buildCustomEndpointModelSubmission({ id: 'custom', supportsImages: false,
    contextWindow: 123456, maxTokens: 8192, supportedThinkingLevels: ['low', 'high'] }))
    .toMatchObject({ contextWindow: 123456, supportedThinkingLevels: ['low', 'high'], supportsThinking: true })
})

it('preserves unspecified thinking capability and distinguishes explicitly disabled thinking', () => {
  const input = { id: 'legacy', supportsImages: false, contextWindow: 500000, maxTokens: 131072 }
  const legacy = buildCustomEndpointModelSubmission(input)
  expect(legacy).not.toHaveProperty('supportedThinkingLevels')
  expect(legacy).not.toHaveProperty('supportsThinking')
  expect(buildCustomEndpointModelSubmission({ ...input, supportedThinkingLevels: [] }))
    .toMatchObject({ supportedThinkingLevels: [], supportsThinking: false })
})
