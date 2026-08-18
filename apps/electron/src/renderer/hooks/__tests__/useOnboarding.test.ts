import { describe, it, expect, mock } from 'bun:test'
import type { ApiSetupMethod } from '@/components/onboarding'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const {
  resolveSlugForMethod,
  apiSetupMethodToConnectionSetup,
  BASE_SLUG_FOR_METHOD,
} = await import('../useOnboarding')

describe('resolveSlugForMethod', () => {
  it('returns the base slug when it is available', () => {
    const slug = resolveSlugForMethod('pi_api_key', null, new Set())
    expect(slug).toBe('pi-api-key')
  })

  it('reuses editingSlug when editing an existing connection', () => {
    const slug = resolveSlugForMethod('pi_api_key', 'my-custom-slug', new Set(['pi-api-key']))
    expect(slug).toBe('my-custom-slug')
  })

  it('appends -2 when base slug is taken', () => {
    const slug = resolveSlugForMethod('pi_api_key', null, new Set(['pi-api-key']))
    expect(slug).toBe('pi-api-key-2')
  })

  it('appends -3 when both base and -2 are taken', () => {
    const slug = resolveSlugForMethod('pi_api_key', null, new Set(['pi-api-key', 'pi-api-key-2']))
    expect(slug).toBe('pi-api-key-3')
  })

  it('works for all setup methods', () => {
    const methods: ApiSetupMethod[] = [
      'pi_chatgpt_oauth', 'pi_copilot_oauth', 'pi_api_key',
    ]
    for (const method of methods) {
      const slug = resolveSlugForMethod(method, null, new Set())
      expect(slug).toBe(BASE_SLUG_FOR_METHOD[method])
    }
  })
})

describe('apiSetupMethodToConnectionSetup', () => {
  it('ORDER multi-select persists both model objects and the first as default', () => {
    const models = [
      { id: 'Opus', name: 'Opus', shortName: 'Opus', supportsImages: true },
      { id: 'Laufry', name: 'Laufry', shortName: 'Laufry' },
    ]
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {
        credential: 'sk-order',
        baseUrl: 'https://order.ai.jxepdi.top/v1',
        connectionDefaultModel: 'Opus',
        models,
        customEndpoint: { api: 'openai-completions' },
        modelSelectionMode: 'userDefined3Tier',
      },
      null,
      new Set(),
    )
    expect(setup.slug).toBe('pi-api-key')
    expect(setup.defaultModel).toBe('Opus')
    expect(setup.models).toEqual(models)
    expect(setup.customEndpoint).toEqual({ api: 'openai-completions' })
    expect(setup.modelSelectionMode).toBe('userDefined3Tier')
  })

  it('pi_chatgpt_oauth maps to chatgpt-plus slug', () => {
    const setup = apiSetupMethodToConnectionSetup('pi_chatgpt_oauth', {}, null, new Set())
    expect(setup.slug).toBe('chatgpt-plus')
  })

  it('pi_copilot_oauth maps to github-copilot slug', () => {
    const setup = apiSetupMethodToConnectionSetup('pi_copilot_oauth', {}, null, new Set())
    expect(setup.slug).toBe('github-copilot')
  })

  it('pi_api_key includes piAuthProvider and modelSelectionMode', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {
        credential: 'sk-pi',
        piAuthProvider: 'openai',
        modelSelectionMode: 'userDefined3Tier',
      },
      null,
      new Set(),
    )
    expect(setup.slug).toBe('pi-api-key')
    expect(setup.credential).toBe('sk-pi')
    expect(setup.piAuthProvider).toBe('openai')
    expect(setup.modelSelectionMode).toBe('userDefined3Tier')
  })

  it('uses editingSlug when editing', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      { credential: 'sk-pi' },
      'existing-connection',
      new Set(['pi-api-key']),
    )
    expect(setup.slug).toBe('existing-connection')
  })

  it('generates unique slug when base is taken', () => {
    const setup = apiSetupMethodToConnectionSetup(
      'pi_api_key',
      {},
      null,
      new Set(['pi-api-key']),
    )
    expect(setup.slug).toBe('pi-api-key-2')
  })
})

describe('reauth slug resolution', () => {
  it('slug override wins over null editingSlug (stale closure scenario)', () => {
    const existingSlugs = new Set(['chatgpt-plus'])

    const wrongSlug = resolveSlugForMethod('pi_chatgpt_oauth', null, existingSlugs)
    expect(wrongSlug).toBe('chatgpt-plus-2')

    const correctSlug = resolveSlugForMethod('pi_chatgpt_oauth', 'chatgpt-plus', existingSlugs)
    expect(correctSlug).toBe('chatgpt-plus')
  })

  it('apiSetupMethodToConnectionSetup uses override chatGPT slug for reauth', () => {
    const existingSlugs = new Set(['chatgpt-plus'])
    const setup = apiSetupMethodToConnectionSetup(
      'pi_chatgpt_oauth',
      {},
      'chatgpt-plus',
      existingSlugs,
    )
    expect(setup.slug).toBe('chatgpt-plus')
  })

  it('new connection flow still generates unique slugs when base is taken', () => {
    const existingSlugs = new Set(['chatgpt-plus'])
    const setup = apiSetupMethodToConnectionSetup(
      'pi_chatgpt_oauth',
      {},
      null,
      existingSlugs,
    )
    expect(setup.slug).toBe('chatgpt-plus-2')
  })

  it('copilot reauth uses override slug', () => {
    const existingSlugs = new Set(['github-copilot'])
    const slug = resolveSlugForMethod('pi_copilot_oauth', 'github-copilot', existingSlugs)
    expect(slug).toBe('github-copilot')
  })
})
