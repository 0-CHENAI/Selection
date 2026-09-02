import type { WebSearchProvider, WebSearchResult } from '../types.ts';

/**
 * Keeps the web_search tool registered so refreshed credentials can enable it
 * later, while guaranteeing that unsupported connections never contact an
 * implicit third-party fallback.
 */
export class UnavailableSearchProvider implements WebSearchProvider {
  readonly name = 'Unavailable';

  async search(_query: string, _count: number): Promise<WebSearchResult[]> {
    throw new Error(
      'Web search is unavailable for this connection because it has no configured provider-native search support.',
    );
  }
}
