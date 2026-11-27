/**
 * Google search provider — uses Gemini API with native Google Search grounding.
 *
 * Makes a separate Gemini API call with `{ googleSearch: {} }` as a tool.
 * The Gemini API doesn't allow combining `googleSearch` grounding with function
 * calling in the same request, so this runs as a side-call.
 */

import { createSearchSignal, normalizeSearchUrl, type WebSearchProvider, type WebSearchResult } from '../types.ts';

const GROUNDING_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash',
] as const;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  searchEntryPoint?: { renderedContent?: string };
  webSearchQueries?: string[];
}

export class GoogleSearchProvider implements WebSearchProvider {
  name = 'Google';
  private preferredModelIndex = 0;

  constructor(private apiKey: string) {}

  async search(query: string, count: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
    let response: Response | undefined;
    let lastErrorText = '';

    for (let i = this.preferredModelIndex; i < GROUNDING_MODELS.length; i += 1) {
      const model = GROUNDING_MODELS[i]!;
      const url = `${API_BASE}/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: query }] }],
          tools: [{ googleSearch: {} }],
        }),
        signal: createSearchSignal(signal),
      });

      if (res.ok) {
        this.preferredModelIndex = i;
        response = res;
        break;
      }

      lastErrorText = await res.text();
      const hasNext = i < GROUNDING_MODELS.length - 1;
      if (res.status === 404 && hasNext) {
        continue;
      }
      throw new Error(`Google Search failed (HTTP ${res.status}): ${lastErrorText}`);
    }

    if (!response) {
      throw new Error(`Google Search failed: ${lastErrorText}`);
    }

    const data = (await response.json()) as any;
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      throw new Error(`Google Search returned no results for "${query}"`);
    }

    // Extract the grounded text response
    const text = candidate.content.parts
      .map((p: any) => p.text || '')
      .join('')
      .trim();

    // Extract source citations from grounding metadata
    const metadata: GroundingMetadata | undefined = candidate.groundingMetadata;
    const chunks = metadata?.groundingChunks || [];

    if (chunks.length > 0) {
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();
      for (const chunk of chunks) {
        const url = normalizeSearchUrl(chunk.web?.uri);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        results.push({ title: chunk.web?.title || url, url, description: '' });
        if (results.length >= count) break;
      }
      if (results.length > 0) return results;
    }

    // Fallback: return the grounded text as a single result
    return [
      {
        title: `Search results for "${query}"`,
        url: '',
        description: text.slice(0, 500),
      },
    ];
  }
}
