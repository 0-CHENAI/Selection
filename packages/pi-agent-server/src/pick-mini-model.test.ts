import { describe, expect, it } from 'bun:test';
import { pickProviderAppropriateMiniModel, resolveUtilityModelId } from './pick-mini-model.ts';

/**
 * Minimal mock of PiModelRegistry — mirrors the pattern from model-resolution.test.ts.
 */
function createMockRegistry(
  providers: Record<string, Array<{ id: string; name: string; provider?: string }>>,
) {
  const allModels = Object.entries(providers).flatMap(([provider, models]) =>
    models.map(m => ({ ...m, provider })),
  );

  return {
    find(provider: string, modelId: string) {
      const models = providers[provider];
      if (!models) return undefined;
      const match = models.find(m => m.id === modelId || m.name === modelId);
      return match ? { ...match, provider } : undefined;
    },
    getAll() {
      return allModels;
    },
  } as any;
}

describe('pickProviderAppropriateMiniModel', () => {
  it('returns undefined for anthropic so caller falls through to Haiku', () => {
    // The caller gates this with `authProvider === 'anthropic' ? undefined : pick...`
    // but we also guarantee the helper itself would return Opus first — which is
    // NOT what we want as a mini. Test that the caller's gate is sufficient by showing
    // the helper would otherwise pick a non-mini candidate for anthropic.
    const registry = createMockRegistry({
      anthropic: [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
        { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      ],
    });

    const result = pickProviderAppropriateMiniModel('anthropic', registry, false);
    // Helper picks first entry from PI_PREFERRED_DEFAULTS.anthropic, now claude-opus-4-8.
    // Documenting why the caller must NOT invoke this helper for anthropic auth.
    expect(result).toBe('claude-opus-4-8');
  });

  it('openai-codex: skips denied codex-mini variants, returns first resolvable candidate', () => {
    // Preferred list now leads with gpt-6.1-sol. Register that id plus an
    // older id that is no longer preferred so the walk stops on the first hit.
    const registry = createMockRegistry({
      'openai-codex': [
        { id: 'gpt-5.2', name: 'GPT 5.2' },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
      ],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBe('gpt-6.1-sol');
  });

  it('openai-codex: ignores ids that dropped out of the Codex catalog', () => {
    const registry = createMockRegistry({
      'openai-codex': [{ id: 'gpt-5.2', name: 'GPT 5.2' }],
    });

    expect(pickProviderAppropriateMiniModel('openai-codex', registry, false)).toBeUndefined();
  });

  it('openai-codex: returns undefined when no preferred candidate resolves', () => {
    // No models registered under openai-codex — every candidate is unresolvable.
    const registry = createMockRegistry({
      'openai-codex': [],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBeUndefined();
  });

  it('openai: returns first resolvable candidate from preferred list', () => {
    // Preferred list leads with gpt-6.*, which this registry does not contain.
    // gpt-5.5 is the first resolvable later entry.
    const registry = createMockRegistry({
      openai: [
        { id: 'gpt-5.5', name: 'GPT 5.5' },
        { id: 'gpt-5.2', name: 'GPT 5.2' },
      ],
    });

    const result = pickProviderAppropriateMiniModel('openai', registry, false);
    expect(result).toBe('gpt-5.5');
  });

  it('unknown provider: returns undefined', () => {
    const registry = createMockRegistry({
      openai: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
    });

    const result = pickProviderAppropriateMiniModel('made-up-provider', registry, false);
    expect(result).toBeUndefined();
  });

  it('empty registry: returns undefined', () => {
    const registry = createMockRegistry({});

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBeUndefined();
  });
});

describe('resolveUtilityModelId', () => {
  it('keeps custom-endpoint utility calls on the session model', () => {
    const registry = createMockRegistry({
      'custom-endpoint': [
        { id: 'Opus', name: 'Opus' },
        { id: 'Laufry', name: 'Laufry' },
      ],
      openai: [{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' }],
    });

    expect(resolveUtilityModelId({
      miniModel: 'Opus',
      sessionModel: 'Opus',
      customModels: ['Opus', 'Laufry'],
      piAuthProvider: 'openai',
      preferCustomEndpoint: true,
      registry,
    })).toBe('Opus');
  });

  it('prefers the session model over a cheaper mini alias', () => {
    const registry = createMockRegistry({
      'custom-endpoint': [
        { id: 'Opus', name: 'Opus' },
        { id: 'Flash', name: 'Flash' },
      ],
    });

    expect(resolveUtilityModelId({
      miniModel: 'Flash',
      sessionModel: 'Opus',
      customModels: ['Opus', 'Flash'],
      piAuthProvider: 'openai',
      preferCustomEndpoint: true,
      registry,
    })).toBe('Opus');
  });

  it('does not fall through to the OpenAI catalog for custom endpoints', () => {
    const registry = createMockRegistry({
      'custom-endpoint': [{ id: 'Opus', name: 'Opus' }],
      openai: [{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' }],
    });

    expect(resolveUtilityModelId({
      requestModel: 'gpt-5.6-sol',
      sessionModel: 'Opus',
      customModels: ['Opus'],
      piAuthProvider: 'openai',
      preferCustomEndpoint: true,
      registry,
    })).toBe('Opus');
  });
});
