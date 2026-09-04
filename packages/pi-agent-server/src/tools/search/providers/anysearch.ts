/**
 * AnySearch provider — default free web search, no LLM API key required.
 *
 * Uses POST https://api.anysearch.com/v1/search with anonymous access.
 * Optional ANYSEARCH_API_KEY raises rate limits without exposing the active
 * model connection's credential to a different provider.
 */

import type { WebSearchProvider, WebSearchResult } from '../types.ts';

const ANYSEARCH_API_URL = 'https://api.anysearch.com/v1/search';
const SEARCH_TIMEOUT_MS = 30_000;
const CLIENT_HEADER = 'selection/web_search';

interface AnySearchEnvelope {
  code?: unknown;
  message?: unknown;
  data?: {
    results?: unknown;
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseAnySearchResults(value: unknown, query: string, count: number): WebSearchResult[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AnySearch returned an invalid response envelope');
  }

  const envelope = value as AnySearchEnvelope;
  if (envelope.code !== 0) {
    const message = asNonEmptyString(envelope.message) ?? 'unknown error';
    throw new Error(`AnySearch search failed: ${message}`);
  }

  const rawResults = envelope.data?.results;
  if (!Array.isArray(rawResults)) {
    throw new Error('AnySearch returned no results array');
  }

  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const item of rawResults) {
    if (results.length >= count) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const record = item as Record<string, unknown>;
    const url = asNonEmptyString(record.url);
    if (!url) continue;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;

    const normalizedUrl = parsed.toString();
    if (seenUrls.has(normalizedUrl)) continue;

    const title = asNonEmptyString(record.title) ?? normalizedUrl;
    const description =
      asNonEmptyString(record.snippet) ??
      asNonEmptyString(record.description) ??
      asNonEmptyString(record.content) ??
      '';

    seenUrls.add(normalizedUrl);
    results.push({ title, url: normalizedUrl, description });
  }

  return results;
}

export class AnySearchSearchProvider implements WebSearchProvider {
  readonly name = 'AnySearch';

  constructor(private readonly apiKey?: string) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const key = this.apiKey || process.env.ANYSEARCH_API_KEY;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Anysearch-Client': CLIENT_HEADER,
    };
    if (key) headers.Authorization = `Bearer ${key}`;

    const response = await fetch(ANYSEARCH_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, max_results: count }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AnySearch search failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`AnySearch returned invalid JSON: ${message}`);
    }

    return parseAnySearchResults(payload, query, count);
  }
}
