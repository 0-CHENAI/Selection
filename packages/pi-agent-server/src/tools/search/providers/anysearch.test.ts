import { afterEach, describe, expect, it } from 'bun:test';
import { AnySearchSearchProvider, parseAnySearchResults } from './anysearch.ts';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ANYSEARCH_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.ANYSEARCH_API_KEY;
  } else {
    process.env.ANYSEARCH_API_KEY = originalApiKey;
  }
});

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseAnySearchResults', () => {
  it('maps supported descriptions and skips invalid or duplicate URLs', () => {
    const results = parseAnySearchResults(
      {
        code: 0,
        data: {
          results: [
            { title: 'A', url: 'https://a.com', snippet: 'first' },
            { title: 'Missing url' },
            { title: 'Bad protocol', url: 'ftp://x.com' },
            { title: 'A duplicate', url: 'https://a.com', snippet: 'duplicate' },
            { title: 'B', url: 'https://b.com', content: 'second' },
          ],
        },
      },
      'craft',
      5,
    );

    expect(results).toEqual([
      { title: 'A', url: 'https://a.com/', description: 'first' },
      { title: 'B', url: 'https://b.com/', description: 'second' },
    ]);
  });

  it('rejects failed envelopes but accepts a successful empty result set', () => {
    expect(() =>
      parseAnySearchResults({ code: -1, message: 'Rate limited' }, 'craft', 5),
    ).toThrow('Rate limited');
    expect(parseAnySearchResults(
      { code: 0, data: { results: [] } },
      'craft',
      5,
    )).toEqual([]);
  });
});

describe('AnySearchSearchProvider', () => {
  it('uses anonymous AnySearch without forwarding LLM credentials', async () => {
    let calledUrl = '';
    let calledBody: unknown;
    let calledHeaders: Record<string, string> = {};

    delete process.env.ANYSEARCH_API_KEY;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = typeof input === 'string' ? input : input.toString();
      calledBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      calledHeaders = (init?.headers as Record<string, string> | undefined) ?? {};
      return okResponse({
        code: 0,
        data: {
          results: [{ title: 'Craft', url: 'https://example.com', snippet: 'ok' }],
        },
      });
    }) as typeof fetch;

    const results = await new AnySearchSearchProvider().search('craft agent', 3);

    expect(calledUrl).toBe('https://api.anysearch.com/v1/search');
    expect(calledBody).toEqual({ query: 'craft agent', max_results: 3 });
    expect(calledHeaders['X-Anysearch-Client']).toBe('selection/web_search');
    expect(calledHeaders.Authorization).toBeUndefined();
    expect(results).toEqual([
      { title: 'Craft', url: 'https://example.com/', description: 'ok' },
    ]);
  });

  it('only sends a dedicated AnySearch API key', async () => {
    let calledHeaders: Record<string, string> = {};

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calledHeaders = (init?.headers as Record<string, string> | undefined) ?? {};
      return okResponse({
        code: 0,
        data: { results: [{ title: 'Keyed', url: 'https://keyed.example' }] },
      });
    }) as typeof fetch;

    await new AnySearchSearchProvider('as_sk_test').search('craft', 1);
    expect(calledHeaders.Authorization).toBe('Bearer as_sk_test');
  });

  it('surfaces HTTP and JSON failures', async () => {
    globalThis.fetch = (async () =>
      new Response('quota exceeded', { status: 429 })) as typeof fetch;
    await expect(new AnySearchSearchProvider().search('craft', 1)).rejects.toThrow(
      'AnySearch search failed (HTTP 429)',
    );

    globalThis.fetch = (async () =>
      new Response('not-json', { status: 200 })) as typeof fetch;
    await expect(new AnySearchSearchProvider().search('craft', 1)).rejects.toThrow(
      'AnySearch returned invalid JSON',
    );
  });
});
