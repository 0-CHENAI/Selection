import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';
import { resolvePiModel, isDeniedMiniModelId } from './model-resolution.ts';
import { PI_PREFERRED_DEFAULTS } from '../../shared/src/config/llm-connections.ts';

/**
 * Choose a utility-completion model (title, summarization, call_llm default).
 *
 * Custom endpoints must stay on `custom-endpoint`. Falling through to the
 * OpenAI catalog (gpt-5.6-sol, …) sends the request somewhere else, so the
 * local backend sits idle while Selection looks stalled.
 */
export function resolveUtilityModelId(args: {
  requestModel?: string
  miniModel?: string
  sessionModel?: string
  customModels?: Array<string | { id: string }>
  piAuthProvider?: string
  preferCustomEndpoint: boolean
  registry: PiModelRegistry
}): string | undefined {
  const candidates: string[] = [];
  const push = (id?: string) => {
    const trimmed = id?.trim();
    if (!trimmed || candidates.includes(trimmed)) return;
    if (isDeniedMiniModelId(trimmed, args.piAuthProvider)) return;
    candidates.push(trimmed);
  };
  // Session model before mini: on custom endpoints the "cheap" mini may be
  // a different worker than the one the user is watching.
  push(args.requestModel);
  push(args.sessionModel);
  push(args.miniModel);
  for (const model of args.customModels ?? []) {
    push(typeof model === 'string' ? model : model.id);
  }

  for (const candidate of candidates) {
    const resolved = resolvePiModel(
      args.registry,
      candidate,
      args.piAuthProvider,
      args.preferCustomEndpoint,
    );
    if (!resolved) continue;
    const provider = (resolved as { provider?: string }).provider;
    if (args.preferCustomEndpoint) {
      if (provider === 'custom-endpoint') return candidate;
      continue;
    }
    if (
      !args.piAuthProvider
      || provider === args.piAuthProvider
      || provider === 'custom-endpoint'
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Pick an auth-provider-appropriate default mini model.
 *
 * `getDefaultSummarizationModel()` returns `claude-haiku-4-5`, which only resolves
 * under `anthropic` auth. For `openai` / `openai-codex` / `google` /
 * `github-copilot` / `amazon-bedrock` we need a model from that provider's
 * preferred list — otherwise the ephemeral session ends up with no explicit
 * model and Pi SDK's internal default (post-0.70.0 an openai model) is used,
 * surfacing as a misleading "No API key found for openai" error when the user
 * is authenticated under a different provider.
 *
 * Walks `PI_PREFERRED_DEFAULTS[authProvider]` and returns the first candidate
 * that is not denied by `isDeniedMiniModelId` and resolves via `resolvePiModel`.
 *
 * Returns `undefined` when there is no resolvable candidate; callers should
 * fall back to `getDefaultSummarizationModel()` in that case.
 */
export function pickProviderAppropriateMiniModel(
  authProvider: string,
  modelRegistry: PiModelRegistry,
  preferCustomEndpoint: boolean,
): string | undefined {
  const preferred = PI_PREFERRED_DEFAULTS[authProvider];
  if (!preferred || preferred.length === 0) return undefined;
  for (const candidate of preferred) {
    if (isDeniedMiniModelId(candidate, authProvider)) continue;
    const resolved = resolvePiModel(modelRegistry, candidate, authProvider, preferCustomEndpoint);
    if (resolved) return candidate;
  }
  return undefined;
}
