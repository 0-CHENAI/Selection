/**
 * Resolves the provider used by the built-in `web_search` tool.
 *
 * Search credentials are intentionally independent from the active LLM
 * connection. OpenAI-compatible endpoints reuse `provider: "openai"` for
 * protocol selection, so routing on piAuth would leak custom provider keys to
 * api.openai.com. AnySearch is anonymous by default and only reads its own
 * optional ANYSEARCH_API_KEY.
 */

import type { WebSearchProvider } from './types.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';

export function resolveSearchProvider(): WebSearchProvider {
  return new AnySearchSearchProvider();
}
