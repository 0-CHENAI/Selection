import { afterEach, describe, expect, it } from 'bun:test';
import { DeepSeekSearchProvider, parseDeepSeekSearchResults } from './deepseek.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('DeepSeekSearchProvider', () => {
  it('uses the official Search API and returns structured sources', async () => {
    let url = '';
    let body: any;
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      headers = init?.headers as Record<string, string>;
      return Response.json({
        results: [{ title: 'DeepSeek', url: 'https://api-docs.deepseek.com/', snippet: 'Official docs' }],
      });
    }) as typeof fetch;

    const results = await new DeepSeekSearchProvider('sk-test').search('DeepSeek docs', 3);

    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(body).toEqual({ query: 'DeepSeek docs', count: 3, need_content: false });
    expect(results[0]).toEqual({
      title: 'DeepSeek',
      url: 'https://api-docs.deepseek.com/',
      description: 'Official docs',
    });
  });

  it('filters unsafe and duplicate result URLs', () => {
    expect(parseDeepSeekSearchResults({
      results: [
        { url: 'javascript:alert(1)', title: 'unsafe' },
        { url: 'https://example.com', title: 'first', summary: 'summary' },
        { url: 'https://example.com/', title: 'duplicate' },
      ],
    }, 10)).toEqual([{
      title: 'first',
      url: 'https://example.com/',
      description: 'summary',
    }]);
  });
});
