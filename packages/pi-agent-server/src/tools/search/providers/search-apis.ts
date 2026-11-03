/** Official standalone web-search APIs. Credentials are never shared between providers. */
import { createSearchSignal, normalizeSearchUrl, type WebSearchProvider, type WebSearchResult } from '../types.ts';

export type StandaloneSearchId = 'tavily' | 'exa' | 'brave';
const names: Record<StandaloneSearchId, string> = { tavily: 'Tavily', exa: 'Exa', brave: 'Brave Search' };

export class StandaloneSearchProvider implements WebSearchProvider {
  readonly name: string;
  constructor(private readonly id: StandaloneSearchId, private readonly key: string) { this.name = names[id]; }

  async search(query: string, count: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
    let url: string;
    let init: RequestInit;
    if (this.id === 'brave') {
      const params = new URLSearchParams({ q: query, count: String(count) });
      url = `https://api.search.brave.com/res/v1/web/search?${params}`;
      init = { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': this.key } };
    } else {
      url = this.id === 'tavily' ? 'https://api.tavily.com/search' : 'https://api.exa.ai/search';
      init = { method: 'POST', headers: this.id === 'tavily'
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` }
        : { 'Content-Type': 'application/json', 'x-api-key': this.key },
      body: JSON.stringify(this.id === 'tavily'
        ? { query, max_results: count, search_depth: 'basic' }
        : { query, numResults: count, type: 'auto', contents: { highlights: true } }) };
    }
    const response = await fetch(url, { ...init, signal: createSearchSignal(signal) });
    if (!response.ok) throw new Error(`${this.name} search failed (HTTP ${response.status})`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`${this.name} returned an invalid response`);
    const envelope = body as Record<string, unknown>;
    const raw = this.id === 'brave' ? (envelope.web as Record<string, unknown> | undefined)?.results : envelope.results;
    if (!Array.isArray(raw)) throw new Error(`${this.name} returned no results array`);
    const seen = new Set<string>();
    const results: WebSearchResult[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const resultUrl = normalizeSearchUrl(record.url);
      if (!resultUrl || seen.has(resultUrl)) continue;
      seen.add(resultUrl);
      const highlights = Array.isArray(record.highlights) ? record.highlights.filter((v): v is string => typeof v === 'string').join(' ') : '';
      const description = [record.content, record.description, highlights, record.text].find(v => typeof v === 'string' && v.trim()) as string | undefined;
      results.push({ title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : resultUrl,
        url: resultUrl, description: description?.trim() ?? '' });
      if (results.length >= count) break;
    }
    return results;
  }
}
