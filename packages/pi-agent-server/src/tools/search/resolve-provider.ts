/**
 * Resolves the provider used by the built-in `web_search` tool.
 *
 * Search credentials are intentionally independent from the active LLM
 * connection. OpenAI-compatible endpoints reuse `provider: "openai"` for
 * protocol selection, so routing on piAuth would leak custom provider keys to
 * api.openai.com. AnySearch is anonymous by default and only reads its own
 * optional ANYSEARCH_API_KEY. A resolver replaces that environment value,
 * including an empty value, so clearing the desktop setting returns to
 * anonymous access without forwarding LLM credentials.
 */

import type { WebSearchProvider } from './types.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';

export function resolveSearchProvider(
  resolveApiKey?: () => Promise<string | null | undefined>,
): WebSearchProvider {
  return new AnySearchSearchProvider(undefined, resolveApiKey);
}

/** Ask the parent process for the current settings key, without caching it. */
export function requestAnySearchApiKey(
  send: (message: { type: 'anysearch_api_key_request'; id: string }) => void,
  pending: Map<string, (apiKey: string) => void>,
  timeoutMs = 5_000,
): Promise<string> {
  const id = `anysearch-key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve('');
    }, timeoutMs);
    pending.set(id, apiKey => {
      clearTimeout(timer);
      resolve(apiKey);
    });
    send({ type: 'anysearch_api_key_request', id });
  });
}
