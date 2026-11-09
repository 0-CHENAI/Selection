import { afterEach, describe, expect, it } from 'bun:test';
import { KimiSearchProvider, parseKimiSearchResults } from './kimi.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('KimiSearchProvider', () => {
  it('uses the regional official Web Search Basic endpoint', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({
        search_results: [{ title: 'Kimi', url: 'https://platform.kimi.ai/docs/', snippet: 'Official docs' }],
      });
    }) as typeof fetch;

    await new KimiSearchProvider('global-key', 'moonshotai').search('Kimi docs', 4);
    await new KimiSearchProvider('cn-key', 'moonshotai-cn').search('Kimi 文档', 2);

    expect(calls[0]?.url).toBe('https://api.moonshot.ai/v1/tools/search');
    expect(calls[1]?.url).toBe('https://api.moonshot.cn/v1/tools/search');
    expect(calls[0]?.body).toEqual({
      text_query: 'Kimi docs',
      limit: 4,
      timeout_seconds: 30,
      include_content: false,
    });
  });

  it('parses and limits safe structured sources', () => {
    expect(parseKimiSearchResults({
      search_results: [
        { title: 'unsafe', url: 'data:text/plain,nope', snippet: '' },
        { title: 'one', url: 'https://one.example', snippet: 'first' },
        { title: 'two', url: 'https://two.example', snippet: 'second' },
      ],
    }, 1)).toEqual([{
      title: 'one',
      url: 'https://one.example/',
      description: 'first',
    }]);
  });
});
