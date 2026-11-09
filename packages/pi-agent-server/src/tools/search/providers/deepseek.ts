/** DeepSeek native Search API provider. */

import { createSearchSignal, normalizeSearchUrl, type WebSearchProvider, type WebSearchResult } from '../types.ts';

const SEARCH_URL = 'https://api.deepseek.com/v1/tools/search';

export function parseDeepSeekSearchResults(value: unknown, count: number): WebSearchResult[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DeepSeek Search returned an invalid response envelope');
  }
  const rawResults = (value as { results?: unknown }).results;
  if (!Array.isArray(rawResults)) throw new Error('DeepSeek Search returned no results array');

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
      description:
        (typeof record.snippet === 'string' && record.snippet.trim()) ||
        (typeof record.summary === 'string' && record.summary.trim()) ||
        '',
    });
    if (results.length >= count) break;
  }
  return results;
}

export class DeepSeekSearchProvider implements WebSearchProvider {
  readonly name = 'DeepSeek';

  constructor(private readonly apiKey: string) {}

  async search(query: string, count: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
    const response = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, count, need_content: false }),
      signal: createSearchSignal(signal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek Search failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
    }

    return parseDeepSeekSearchResults(await response.json(), count);
  }
}
