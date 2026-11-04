import type { ProviderDriver, DriverTestConnectionArgs } from '../driver-types.ts';
import type { ModelDefinition } from '../../../../config/models.ts';
import { thinkingFieldsFromUpstream } from '../../../thinking-capabilities.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';
import { getPiProviderBaseUrl } from '../../../../config/models-pi.ts';
import { toPiProviderId } from '../../../../config/pi-provider-ids.ts';
import { toCustomEndpointModelWithThinking } from '../../../custom-endpoint-thinking.ts';
import { toCustomEndpointModelPayload } from '../../../../config/model-image-support.ts';
import { withResolvedContextWindow } from '../../../../config/model-context-window.ts';
import {
  fetchOpenRouterCatalog,
  openRouterCatalogToModelDefinitions,
} from '../../../../config/openrouter-catalog.ts';

// ── Copilot model types ────────────────────────────────────────────────
type RawCopilotModel = {
  id: string;
  name: string;
  supportedReasoningEfforts?: string[];
  policy?: { state: string };
  contextWindow?: number;
};

// ── Direct HTTP approach ─────────────────────────────────────────────

/** Headers that identify us as a VS Code Copilot client (same as Pi SDK). */
const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
} as const;

/** Extract API base URL from a Copilot API token's proxy-ep field. */
function getBaseUrlFromToken(token: string): string | null {
  const match = token.match(/proxy-ep=([^;]+)/);
  if (!match?.[1]) return null;
  const apiHost = match[1].replace(/^proxy\./, 'api.');
  return `https://${apiHost}`;
}

/**
 * Fetch models directly from the Copilot API via HTTP.
 *
 * 1. Exchange GitHub OAuth token → Copilot API token (via Pi SDK)
 * 2. Extract base URL from token's proxy-ep field
 * 3. GET /models to list available models with policy state
 *
 * No CLI subprocess, no PATH issues, no env contamination.
 */
async function listModelsViaHttp(
  githubToken: string,
  timeoutMs: number,
): Promise<RawCopilotModel[]> {
  const { refreshGitHubCopilotTokenWithSdk } = await import('../../../../auth/github-copilot-sdk.ts');

  // Step 1: Exchange GitHub OAuth token → Copilot API token
  const creds = await refreshGitHubCopilotTokenWithSdk(githubToken);
  const copilotToken = creds.access;

  // Step 2: Extract base URL from token
  const baseUrl = getBaseUrlFromToken(copilotToken);
  if (!baseUrl) {
    throw new Error('Could not extract API base URL from Copilot token (missing proxy-ep)');
  }

  console.warn(`[listModelsViaHttp] token exchange OK, baseUrl=${baseUrl}`);

  // Step 3: GET /models
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${copilotToken}`,
        ...COPILOT_HEADERS,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Copilot API ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as Record<string, unknown>;
    // Handle both { models: [...] } and { data: [...] } response formats
    const models = data.models ?? data.data;
    if (!Array.isArray(models)) throw new Error('Invalid Copilot models response');
    if (models.some(model => !model || typeof model !== 'object' || typeof model.id !== 'string' || !model.id.trim())) {
      throw new Error('Invalid Copilot model entry');
    }

    console.warn(`[listModelsViaHttp] GET /models returned ${models.length} models`);

    return (models as Record<string, unknown>[]).map(m => ({
      id: m.id as string,
      name: (m.name || m.id) as string,
      supportedReasoningEfforts: (m.supportedReasoningEfforts || m.supported_reasoning_efforts) as string[] | undefined,
      policy: m.policy as { state: string } | undefined,
      contextWindow: ((m.capabilities as Record<string, unknown>)?.limits as Record<string, unknown>)?.max_context_window_tokens as number | undefined,
    }));
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Copilot models API timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Filter raw models to only those explicitly enabled by policy. */
function filterEnabledModels(models: RawCopilotModel[]): RawCopilotModel[] {
  return models.filter(m => m.policy?.state === 'enabled');
}

/** Convert raw Copilot models to our ModelDefinition format. */
function toModelDefinitions(models: RawCopilotModel[]): ModelDefinition[] {
  return models.map(m => ({
    id: m.id,
    name: m.name,
    shortName: m.name,
    description: '',
    provider: 'pi' as const,
    contextWindow: m.contextWindow || 200_000,
    ...thinkingFieldsFromUpstream({
      id: m.id,
      supportedReasoningEfforts: m.supportedReasoningEfforts,
      reasoning: !!(m.supportedReasoningEfforts && m.supportedReasoningEfforts.length > 0),
    }),
  }));
}

/** Log a breakdown of models by policy state. */
function logModelBreakdown(tag: string, models: RawCopilotModel[]): void {
  const byState = new Map<string, string[]>();
  for (const m of models) {
    const state = m.policy?.state ?? 'no-policy';
    const list = byState.get(state) ?? [];
    list.push(m.id);
    byState.set(state, list);
  }
  const breakdown = [...byState.entries()].map(([s, ids]) => `${s}=${ids.length}(${ids.join(',')})`).join('; ');
  console.warn(`[fetchCopilotModels] ${tag}: total=${models.length} enabled=${filterEnabledModels(models).length} | ${breakdown}`);
}

/**
 * Fetch the live Copilot list, filtered by the account's policy. Failures
 * propagate so the refresh service can retain the last successful list.
 */
async function fetchCopilotModels(
  piSdkGitHubToken: string,
  timeoutMs: number,
): Promise<ModelDefinition[]> {

  const raw = await listModelsViaHttp(piSdkGitHubToken, timeoutMs);
  logModelBreakdown('httpApi', raw);
  const enabled = filterEnabledModels(raw);
  return toModelDefinitions(enabled);
}

function customEndpointModelsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return '';
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

/**
 * Custom-endpoint setup should prove the key + URL, not that a specific model
 * can complete 16 tokens on the Anthropic Messages API. ORDER lists
 * DeepSeek-V4-Flash (reasoning / OpenAI-shaped) next to Claude-class names;
 * probing `/v1/messages` with that id is a false failure.
 */
async function testCustomEndpointAccess(
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  const url = customEndpointModelsUrl(baseUrl);
  if (!url) {
    return { success: false, error: 'Could not determine API endpoint for provider' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    });

    if (res.ok) return { success: true };

    const text = await res.text().catch(() => '');
    return { success: false, error: `${res.status} ${text}`.slice(0, 500) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: 'Connection test timed out' };
    }
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lightweight direct HTTP test for Pi providers that expose an Anthropic-compatible
 * messages endpoint. Avoids spawning a full Pi subprocess (which can exceed the
 * 20s test timeout due to SDK initialization overhead).
 */
async function testAnthropicCompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  timeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Say ok' }],
      }),
    });

    if (res.ok) return { success: true };

    const text = await res.text().catch(() => '');
    return { success: false, error: `${res.status} ${text}`.slice(0, 500) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: 'Connection test timed out' };
    }
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export const piDriver: ProviderDriver = {
  provider: 'pi',
  buildRuntime: ({ context, providerOptions, resolvedPaths, hostRuntime }) => ({
    paths: {
      piServer: resolvedPaths.piServerPath,
      interceptor: resolvedPaths.interceptorBundlePath,
      node: resolvedPaths.nodeRuntimePath,
    },
    officecliHost: {
      appRootPath: hostRuntime.appRootPath,
      resourcesPath: hostRuntime.resourcesPath,
    },
    piAuthProvider: providerOptions?.piAuthProvider || context.connection?.piAuthProvider,
    baseUrl: context.connection?.baseUrl,
    imagePixelBudget: context.connection?.imagePixelBudget,
    imageMaxBytes: context.connection?.imageMaxBytes,
    imageMaxDimension: context.connection?.imageMaxDimension,
    imageTokenFamily: context.connection?.imageTokenFamily,
    vlHighResolutionImages: context.connection?.vlHighResolutionImages,
    imageMaxPixels: context.connection?.imageMaxPixels,
    customEndpoint: context.connection?.customEndpoint,
    customModels: context.connection?.models?.map((model) => (
      context.connection?.providerType === 'pi_compat' || context.connection?.customEndpoint
        ? toCustomEndpointModelWithThinking(withResolvedContextWindow(model), context.connection?.piAuthProvider)
        : toCustomEndpointModelPayload(withResolvedContextWindow(model))
    )),
  }),
  fetchModels: async ({ connection, credentials, timeoutMs }) => {
    // Copilot OAuth: fetch models directly from the Copilot API via HTTP.
    // Uses the GitHub OAuth token (our refreshToken) to exchange for a
    // Copilot API token, then queries GET /models for the live model list.
    const copilotGitHubToken = credentials.oauthRefreshToken || credentials.oauthAccessToken;
    if (connection.piAuthProvider === 'github-copilot' && connection.authType === 'oauth' && !copilotGitHubToken) {
      throw new Error('GitHub Copilot OAuth credentials are unavailable');
    }
    if (connection.piAuthProvider === 'github-copilot' && copilotGitHubToken) {
      const models = await fetchCopilotModels(copilotGitHubToken, timeoutMs);
      return { models };
    }

    if (connection.piAuthProvider === 'openrouter') {
      try {
        const live = await fetchOpenRouterCatalog({
          apiKey: credentials.apiKey,
          timeoutMs,
        });
        if (live.length > 0) {
          return { models: openRouterCatalogToModelDefinitions(live) };
        }
      } catch (err) {
        console.warn(`[fetchOpenRouterModels] live catalog failed: ${(err as Error).message}`);
      }
    }

    // All other Pi providers: use static Pi SDK model registry
    const models = connection.piAuthProvider
      ? getPiModelsForAuthProvider(connection.piAuthProvider)
      : getAllPiModels();

    if (models.length === 0) {
      throw new Error(
        `No Pi models found for provider: ${connection.piAuthProvider ?? 'all'}`,
      );
    }

    return { models };
  },
  testConnection: async (args: DriverTestConnectionArgs): Promise<{ success: boolean; error?: string } | null> => {
    const firstId = args.model.split(/[,，、]/)[0]?.trim() || args.model;
    const customApi = args.connection?.customEndpoint?.api;
    if (customApi) {
      const baseUrl = args.baseUrl?.trim();
      if (!baseUrl) {
        return { success: false, error: 'Could not determine API endpoint for provider' };
      }
      return testCustomEndpointAccess(args.apiKey, baseUrl, args.timeoutMs);
    }

    const piAuthProvider = args.connection?.piAuthProvider;
    if (!piAuthProvider) {
      // No provider hint — fall back to generic subprocess path
      return null;
    }

    // Resolve the model's API type from the Pi SDK registry.
    // For anthropic-messages providers, do a lightweight direct HTTP test
    // instead of spawning a full Pi subprocess (which can exceed the timeout).
    let modelApi: string | undefined;
    let modelBaseUrl: string | undefined;
    try {
      const { getModels } = await import('@earendil-works/pi-ai/compat');
      const models = getModels(toPiProviderId(piAuthProvider) as Parameters<typeof getModels>[0]);
      const requestedId = firstId.startsWith('pi/') ? firstId.slice(3) : firstId;
      const match = models.find(m => m.id === requestedId) || models[0];
      if (match) {
        modelApi = (match as { api?: string }).api;
        modelBaseUrl = (match as { baseUrl?: string }).baseUrl;
      }
    } catch { /* ignore — fall through to subprocess */ }

    if (modelApi !== 'anthropic-messages') {
      // Non-Anthropic API types need the full Pi SDK — let factory.ts handle it
      return null;
    }

    const baseUrl = args.baseUrl?.trim() || modelBaseUrl || getPiProviderBaseUrl(piAuthProvider);
    if (!baseUrl) {
      return { success: false, error: 'Could not determine API endpoint for provider' };
    }

    // Strip Pi SDK's 'pi/' prefix — Anthropic-compatible endpoints only accept bare model IDs
    let bareModel = firstId.startsWith('pi/') ? firstId.slice(3) : firstId;
    // MiniMax CN API doesn't accept the 'MiniMax-' prefix on model names
    if (piAuthProvider === 'minimax-cn' && bareModel.startsWith('MiniMax-')) {
      bareModel = bareModel.slice('MiniMax-'.length);
    }
    return testAnthropicCompatible(args.apiKey, baseUrl, bareModel, args.timeoutMs);
  },
  validateStoredConnection: async () => ({ success: true }),
};
