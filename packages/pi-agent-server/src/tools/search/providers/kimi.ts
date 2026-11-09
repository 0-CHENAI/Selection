/** Kimi/Moonshot native Web Search Basic provider. */

import { createSearchSignal, normalizeSearchUrl, type WebSearchProvider, type WebSearchResult } from '../types.ts';

const SEARCH_URLS = {
  moonshotai: 'https://api.moonshot.ai/v1/tools/search',
  'moonshotai-cn': 'https://api.moonshot.cn/v1/tools/search',
} as const;

export type MoonshotSearchRegion = keyof typeof SEARCH_URLS;

export function parseKimiSearchResults(value: unknown, count: number): WebSearchResult[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Kimi Web Search returned an invalid response envelope');
  }
  const rawResults = (value as { search_results?: unknown }).search_results;
  if (!Array.isArray(rawResults)) throw new Error('Kimi Web Search returned no search_results array');

  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const item of rawResults) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const url = normalizeSearchUrl(record.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : url,
      url,
      description: typeof record.snippet === 'string' ? record.snippet.trim() : '',
    });
    if (results.length >= count) break;
  }
  return results;
}

export class KimiSearchProvider implements WebSearchProvider {
  readonly name = 'Kimi';

  constructor(
    private readonly apiKey: string,
    private readonly region: MoonshotSearchRegion,
  ) {}

  async search(query: string, count: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
    const response = await fetch(SEARCH_URLS[this.region], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        text_query: query,
        limit: count,
        timeout_seconds: 30,
        include_content: false,
      }),
      signal: createSearchSignal(signal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kimi Web Search failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
    }

    return parseKimiSearchResults(await response.json(), count);
  }
}
