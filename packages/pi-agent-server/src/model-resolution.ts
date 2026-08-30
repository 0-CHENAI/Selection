import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';

// Re-export from shared so the auth-aware mini-model denylist has a single
// source of truth (also used by `getMiniModel()` at selection time).
export { isDeniedMiniModelId } from '../../shared/src/config/llm-connections.ts';

// Re-export the PiModel type used by callers
type PiModel<T = any> = ReturnType<PiModelRegistry['find']>;

function findCustomEndpointModel(
  modelRegistry: PiModelRegistry,
  modelId: string,
): PiModel | undefined {
  const exact = modelRegistry.find('custom-endpoint', modelId);
  if (exact) return exact;

  const lower = modelId.toLowerCase();
  return modelRegistry.getAll().find((model) => {
    const provider = (model as { provider?: string }).provider;
    if (provider !== 'custom-endpoint') return false;
    return model.id.toLowerCase() === lower || model.name.toLowerCase() === lower;
  });
}

/**
 * Resolve a Pi SDK model from the registry, with optional custom-endpoint precedence.
 *
 * Resolution order:
 * 1. If `preferCustomEndpoint` is true, try `'custom-endpoint'` provider first
 * 2. Exact provider+model lookup via `piAuthProvider`
 * 3. Full `getAll()` scan by id/name
 * 4. Common provider fallback list (includes 'custom-endpoint')
 */
export function resolvePiModel(
  modelRegistry: PiModelRegistry,
  modelId: string,
  piAuthProvider?: string,
  preferCustomEndpoint?: boolean,
): PiModel | undefined {
  // Strip Craft's pi/ prefix — Pi SDK uses bare model IDs (e.g. "claude-sonnet-4-6")
  const bareId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;

  // Custom-endpoint takes precedence when configured.
  // Case-insensitive: ORDER ids like DeepSeek-V4-Flash must not miss the
  // registered custom model and fall through to Pi's official DeepSeek catalog.
  if (preferCustomEndpoint) {
    const custom = findCustomEndpointModel(modelRegistry, bareId);
    if (custom) return custom;
  }

  // If we know the auth provider, do an exact provider+model lookup first.
  // This avoids the getAll() ambiguity where the same model ID exists under
  // multiple providers (e.g., "gpt-5.2" under both "openai" and
  // "azure-openai-responses") and the wrong one matches first.
  if (piAuthProvider) {
    const exact = modelRegistry.find(piAuthProvider, bareId);
    if (exact) {
      // MiniMax CN API rejects model IDs with the 'MiniMax-' prefix (e.g. 500 for
      // 'MiniMax-M2.5-highspeed') but accepts bare names ('M2.5-highspeed').
      if (piAuthProvider === 'minimax-cn' && exact.id.startsWith('MiniMax-')) {
        return { ...exact, id: exact.id.slice('MiniMax-'.length) };
      }
      return exact;
    }
  }

  // Fallback: search all available models.
  // When piAuthProvider is set, only return models from the same provider
  // (or 'custom-endpoint'). Without this guard, a model that exists under
  // a different provider (e.g. "gpt-5.4" under "azure-openai-responses"
  // when authed as "github-copilot") would be returned, and the Pi SDK
  // would fail with "No API key found for <wrong-provider>".
  const allModels = modelRegistry.getAll();
  const match = allModels.find(m =>
    (m.id === bareId || m.name === bareId) &&
    (!piAuthProvider || (m as any).provider === piAuthProvider || (m as any).provider === 'custom-endpoint'),
  );
  if (match) return match;

  // Try common providers with the model ID
  const providers = ['custom-endpoint', 'anthropic', 'openai', 'google'];
  for (const provider of providers) {
    // Skip providers incompatible with the authenticated provider
    if (piAuthProvider && provider !== piAuthProvider && provider !== 'custom-endpoint') continue;
    const model = provider === 'custom-endpoint'
      ? findCustomEndpointModel(modelRegistry, bareId)
      : modelRegistry.find(provider, bareId);
    if (model) return model;
  }

  return undefined;
}

/**
 * Returns true when an error message indicates the requested model is unavailable and a
 * different model should be tried. Matches both the standard OpenAI "model not found"
 * shapes and the ChatGPT-account Codex "… is not supported" refusal.
 */
export function isModelNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('model_not_found') ||
    normalized.includes('does not exist') ||
    normalized.includes('no such model') ||
    normalized.includes('is not supported') ||
    (normalized.includes('requested model') && normalized.includes('not') && normalized.includes('exist'))
  );
}

/**
 * A strict model-rejection check for request paths where a generic 400 may instead
 * describe an unsupported tool or parameter. Ambiguous messages only count when
 * they identify the model that was actually requested.
 */
export function isModelRejectionError(message: string, modelId: string): boolean {
  if (!isModelNotFoundError(message)) return false;
  const normalized = message.toLowerCase();
  if (
    normalized.includes('model_not_found') ||
    normalized.includes('no such model') ||
    normalized.includes('requested model')
  ) {
    return true;
  }
  return modelId.length > 0 && normalized.includes(modelId.toLowerCase());
}
