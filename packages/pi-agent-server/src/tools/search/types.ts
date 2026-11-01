export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchProvider {
  /** Display name shown in search results attribution (e.g. "Google", "OpenAI") */
  name: string;
  /** Execute a web search and return structured results. */
  search(query: string, count: number, signal?: AbortSignal): Promise<WebSearchResult[]>;
}

const SEARCH_TIMEOUT_MS = 30_000;

/** Combine user cancellation with the bounded search timeout. */
export function createSearchSignal(signal?: AbortSignal): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)])
    : AbortSignal.timeout(SEARCH_TIMEOUT_MS);
}

/** Return a normalized HTTP(S) URL or null for unsafe/invalid values. */
export function normalizeSearchUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
