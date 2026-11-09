import { afterEach, describe, expect, it } from 'bun:test';
import { StandaloneSearchProvider, type StandaloneSearchId } from './search-apis.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('standalone search APIs', () => {
  for (const [id, url, header, expected, response] of [
    ['tavily', 'https://api.tavily.com/search', 'Authorization', 'Bearer private', { results: [{ title: 'One', url: 'https://example.com', content: 'content' }] }],
    ['exa', 'https://api.exa.ai/search', 'x-api-key', 'private', { results: [{ title: 'One', url: 'https://example.com', highlights: ['content'] }] }],
    ['brave', 'https://api.search.brave.com/res/v1/web/search?q=test&count=3', 'X-Subscription-Token', 'private', { web: { results: [{ title: 'One', url: 'https://example.com', description: 'content' }] } }],
  ] as const) {
    it(`calls ${id} with its own key and normalizes results`, async () => {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(url);
        expect((init?.headers as Record<string, string>)[header]).toBe(expected);
        if (id !== 'brave') expect(JSON.parse(String(init?.body)).query).toBe('test');
        return Response.json(response);
      }) as typeof fetch;
      expect(await new StandaloneSearchProvider(id as StandaloneSearchId, 'private').search('test', 3)).toEqual([{ title: 'One', url: 'https://example.com/', description: 'content' }]);
    });
  }
  it('rejects unsafe URLs and duplicates', async () => {
    globalThis.fetch = (async () => Response.json({ results: [{ url: 'javascript:alert(1)' }, { url: 'https://example.com' }, { url: 'https://example.com/' }] })) as typeof fetch;
    expect(await new StandaloneSearchProvider('tavily', 'private').search('test', 3)).toHaveLength(1);
  });
  it('does not expose response bodies or credentials in HTTP errors', async () => {
    globalThis.fetch = (async () => new Response('private', { status: 403 })) as typeof fetch;
    await expect(new StandaloneSearchProvider('exa', 'private').search('test', 3)).rejects.toThrow('Exa search failed (HTTP 403)');
  });
});
