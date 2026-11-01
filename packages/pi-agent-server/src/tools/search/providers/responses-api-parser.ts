/**
 * Shared parser for the OpenAI Responses API format.
 *
 * Both `api.openai.com/v1/responses` and `chatgpt.com/backend-api/codex/responses`
 * return the same shape: output items with text content and URL-citation annotations.
 * OpenRouter also mirrors this format at `openrouter.ai/api/v1/responses`.
 */

import { normalizeSearchUrl, type WebSearchResult } from '../types.ts';

interface UrlCitation {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

interface ResponsesOutputTextPart {
  type?: string;
  text?: string;
  annotations?: UrlCitation[];
}

interface ResponsesOutputItem {
  type?: string;
  content?: ResponsesOutputTextPart[];
}

export interface ResponsesApiResponse {
  output?: ResponsesOutputItem[];
  output_text?: string;
}

export function collectOutputText(data: ResponsesApiResponse): string {
  const pieces: string[] = [];

  for (const item of data.output || []) {
    if (!Array.isArray(item.content)) continue;

    for (const part of item.content) {
      if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
        pieces.push(part.text);
      }
    }
  }

  if (pieces.length > 0) return pieces.join('\n').trim();
  return typeof data.output_text === 'string' ? data.output_text.trim() : '';
}

interface CitationWithText {
  citation: UrlCitation;
  text: string;
}

function collectUrlCitations(data: ResponsesApiResponse): CitationWithText[] {
  const citations: CitationWithText[] = [];

  for (const item of data.output || []) {
    if (!Array.isArray(item.content)) continue;

    for (const part of item.content) {
      if (!Array.isArray(part.annotations)) continue;

      for (const ann of part.annotations) {
        if (ann?.type === 'url_citation' && ann.url) {
          citations.push({ citation: ann, text: typeof part.text === 'string' ? part.text : '' });
        }
      }
    }
  }

  return citations;
}

/**
 * Parse a Responses API response into WebSearchResult[].
 *
 * Extracts URL citations first (structured results), falls back to a
 * plain-text summary if no citations are found.
 */
export function parseResponsesApiResults(
  data: ResponsesApiResponse,
  query: string,
  count: number,
): WebSearchResult[] {
  const text = collectOutputText(data);
  const citations = collectUrlCitations(data);

  if (citations.length > 0) {
    const seen = new Set<string>();
    const results: WebSearchResult[] = [];

    for (const { citation: ann, text: citationText } of citations) {
      if (results.length >= count) break;
      const url = normalizeSearchUrl(ann.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const description =
        typeof ann.start_index === 'number' &&
        typeof ann.end_index === 'number' &&
        ann.start_index >= 0 &&
        ann.end_index > ann.start_index &&
        ann.end_index <= citationText.length
          ? citationText.slice(ann.start_index, ann.end_index).slice(0, 280)
          : '';

      results.push({
        title: ann.title || url,
        url,
        description,
      });
    }

    if (results.length > 0) return results;
  }

  if (!text) {
    throw new Error('Search returned no content');
  }

  // Fallback: return full text summary as a single result.
  return [
    {
      title: `Search results for "${query}"`,
      url: '',
      description: text,
    },
  ];
}
