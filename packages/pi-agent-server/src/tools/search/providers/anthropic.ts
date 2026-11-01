/** Anthropic server-side web search provider for official API-key connections. */

import { stripPiPrefix } from '../../../custom-endpoint-models.ts';
import { createSearchSignal, normalizeSearchUrl, type WebSearchProvider, type WebSearchResult } from '../types.ts';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const WEB_SEARCH_TOOL = 'web_search_20260318';

interface AnthropicSearchResponse {
  content?: unknown[];
}

export function parseAnthropicSearchResults(value: unknown, count: number): WebSearchResult[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Anthropic Web Search returned an invalid response envelope');
  }

  const content = (value as AnthropicSearchResponse).content;
  if (!Array.isArray(content)) throw new Error('Anthropic Web Search returned no content array');

  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const add = (urlValue: unknown, titleValue: unknown, descriptionValue: unknown) => {
    const url = normalizeSearchUrl(urlValue);
    if (!url || seen.has(url) || results.length >= count) return;
    seen.add(url);
    results.push({
      title: typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : url,
      url,
      description: typeof descriptionValue === 'string' ? descriptionValue.trim() : '',
    });
  };

  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const record = block as Record<string, unknown>;
    if (record.type !== 'web_search_tool_result') continue;
    if (!Array.isArray(record.content)) {
      const error = record.content as { error_code?: unknown } | undefined;
      throw new Error(`Anthropic Web Search failed: ${String(error?.error_code || 'unknown tool error')}`);
    }
    for (const item of record.content) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const result = item as Record<string, unknown>;
      if (result.type === 'web_search_result') add(result.url, result.title, result.page_age);
    }
  }

  if (results.length > 0) return results;

  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const citations = (block as { citations?: unknown }).citations;
    if (!Array.isArray(citations)) continue;
    for (const item of citations) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const citation = item as Record<string, unknown>;
      if (citation.type === 'web_search_result_location') {
        add(citation.url, citation.title, citation.cited_text);
      }
    }
  }

  return results;
}

export class AnthropicSearchProvider implements WebSearchProvider {
  readonly name = 'Anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly model = DEFAULT_MODEL,
  ) {}

  async search(query: string, count: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: stripPiPrefix(this.model),
        max_tokens: 512,
        tools: [{
          type: WEB_SEARCH_TOOL,
          name: 'web_search',
          max_uses: 1,
          allowed_callers: ['direct'],
        }],
        messages: [{
          role: 'user',
          content: `Use web search once for: ${query}\nReturn the top ${count} sources with concise citations.`,
        }],
      }),
      signal: createSearchSignal(signal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic Web Search failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
    }

    const results = parseAnthropicSearchResults(await response.json(), count);
    if (results.length === 0) throw new Error('Anthropic Web Search returned no sources');
    return results;
  }
}
