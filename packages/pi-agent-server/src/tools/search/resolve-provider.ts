/**
 * Resolves the provider used by the built-in `web_search` tool.
 *
 * Provider credentials are reused only for an exact built-in provider id and
 * its official endpoint. Custom endpoints and unsupported auth flavours stay
 * isolated on AnySearch so credentials can never cross provider boundaries.
 */

import type { PiCredential } from '../../adapt-credential.ts';
import { stripPiPrefix } from '../../custom-endpoint-models.ts';
import type { WebSearchProvider } from './types.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';
import { AnthropicSearchProvider } from './providers/anthropic.ts';
import { ChatGPTBackendSearchProvider, extractChatGptAccountId } from './providers/chatgpt.ts';
import { DeepSeekSearchProvider } from './providers/deepseek.ts';
import { GoogleSearchProvider } from './providers/google.ts';
import { KimiSearchProvider } from './providers/kimi.ts';
import { ResponsesApiSearchProvider } from './providers/openai.ts';

export interface SearchProviderAuthConfig {
  provider?: string;
  credential?: PiCredential;
}

export interface SearchProviderOptions {
  /** True when the active model connection targets a user-defined endpoint. */
  customEndpoint?: boolean;
  /** Original connection auth type; OAuth access tokens are not API keys. */
  authType?: string;
  /** Configured model endpoint, when the connection overrides the provider default. */
  baseUrl?: string;
}

const OFFICIAL_PROVIDER_HOSTS: Readonly<Record<string, readonly string[]>> = {
  'openai-codex': ['chatgpt.com'],
  openai: ['api.openai.com'],
  anthropic: ['api.anthropic.com'],
  deepseek: ['api.deepseek.com'],
  google: ['generativelanguage.googleapis.com'],
  moonshotai: ['api.moonshot.ai'],
  'moonshotai-cn': ['api.moonshot.cn'],
};

function hasOfficialEndpoint(provider: string | undefined, options: SearchProviderOptions | undefined): boolean {
  if (!provider || options?.customEndpoint) return false;
  const configured = options?.baseUrl?.trim();
  if (!configured) return true;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' && (OFFICIAL_PROVIDER_HOSTS[provider] || []).includes(url.hostname);
  } catch {
    return false;
  }
}

function chatGptAccessToken(piAuth?: SearchProviderAuthConfig): string | undefined {
  if (piAuth?.provider !== 'openai-codex') return undefined;
  const credential = piAuth.credential;
  if (credential?.type === 'api_key') return credential.key?.trim() || undefined;
  if (credential?.type === 'oauth') return credential.access?.trim() || undefined;
  return undefined;
}

function officialApiKey(
  piAuth: SearchProviderAuthConfig | undefined,
  options: SearchProviderOptions | undefined,
): string | undefined {
  if (!hasOfficialEndpoint(piAuth?.provider, options) || options?.authType === 'oauth') return undefined;
  const credential = piAuth?.credential;
  if (credential?.type !== 'api_key') return undefined;
  return credential.key.trim() || undefined;
}

export function resolveSearchProvider(
  piAuth?: SearchProviderAuthConfig,
  activeModel?: string,
  resolveAnySearchApiKey?: (signal?: AbortSignal) => Promise<string | null | undefined>,
  options?: SearchProviderOptions,
): WebSearchProvider {
  const accessToken = hasOfficialEndpoint(piAuth?.provider, options) ? chatGptAccessToken(piAuth) : undefined;
  if (accessToken) {
    const accountId = extractChatGptAccountId(accessToken);
    if (accountId) {
      return new ChatGPTBackendSearchProvider(
        accessToken,
        accountId,
        activeModel ? { model: activeModel } : undefined,
      );
    }
  }

  const apiKey = officialApiKey(piAuth, options);
  if (apiKey) {
    switch (piAuth?.provider) {
      case 'openai':
        return new ResponsesApiSearchProvider({
          apiBase: 'https://api.openai.com/v1',
          apiKey,
          model: activeModel ? stripPiPrefix(activeModel) : undefined,
          displayName: 'OpenAI',
        });
      case 'anthropic':
        // Claude subscription OAuth tokens use the sk-ant-oat prefix and must
        // not be sent as x-api-key to the developer API.
        if (!apiKey.includes('sk-ant-oat')) {
          return new AnthropicSearchProvider(apiKey, activeModel ? stripPiPrefix(activeModel) : undefined);
        }
        break;
      case 'deepseek':
        return new DeepSeekSearchProvider(apiKey);
      case 'google':
        return new GoogleSearchProvider(apiKey);
      case 'moonshotai':
      case 'moonshotai-cn':
        return new KimiSearchProvider(apiKey, piAuth.provider);
    }
  }

  return new AnySearchSearchProvider(undefined, resolveAnySearchApiKey);
}

/** Resolve per call so refreshed OAuth tokens and model changes take effect. */
export function createDynamicSearchProvider(
  resolveAuth: () => SearchProviderAuthConfig | undefined,
  resolveActiveModel: () => string | undefined,
  resolveAnySearchApiKey?: (signal?: AbortSignal) => Promise<string | null | undefined>,
  resolveOptions?: () => SearchProviderOptions | undefined,
): WebSearchProvider {
  const current = () => resolveSearchProvider(
    resolveAuth(),
    resolveActiveModel(),
    resolveAnySearchApiKey,
    resolveOptions?.(),
  );

  return {
    get name() {
      return current().name;
    },
    search(query, count, signal) {
      return current().search(query, count, signal);
    },
  };
}

/** Ask the parent process for the current settings key, without caching it. */
export function requestAnySearchApiKey(
  send: (message: { type: 'anysearch_api_key_request'; id: string }) => void,
  pending: Map<string, (apiKey: string) => void>,
  timeoutMs = 5_000,
  signal?: AbortSignal,
): Promise<string> {
  const id = `anysearch-key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      pending.delete(id);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      pending.delete(id);
      resolve('');
    }, timeoutMs);
    pending.set(id, apiKey => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(apiKey);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    send({ type: 'anysearch_api_key_request', id });
  });
}
