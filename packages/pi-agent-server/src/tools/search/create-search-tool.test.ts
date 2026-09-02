import { describe, expect, it } from 'bun:test';
import { createSearchTool } from './create-search-tool.ts';
import type { WebSearchProvider } from './types.ts';

describe('createSearchTool', () => {
  it('keeps canonical tool identity', () => {
    const provider: WebSearchProvider = {
      name: 'Mock',
      async search() {
        return [];
      },
    };

    const tool = createSearchTool(provider);

    expect(tool.name).toBe('web_search');
    expect(tool.label).toBe('Web Search');
    expect(tool.description).toContain('Search the web');
  });

  it('clamps count to [1, 10] and formats results', async () => {
    let capturedCount = 0;
    const provider: WebSearchProvider = {
      name: 'MockProvider',
      async search(query, count) {
        capturedCount = count;
        return [{ title: `Result for ${query}`, url: 'https://example.com', description: 'desc' }];
      },
    };

    const tool = createSearchTool(provider);
    const result = await tool.execute('tool-1', { query: 'craft', count: 99 });

    expect(capturedCount).toBe(10);
    expect(result.details?.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as any).text).toContain('(via MockProvider)');
  });

  it('uses an explicitly supplied fallback when the primary provider fails', async () => {
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error('401 missing scope');
      },
    };

    const fallbackProvider: WebSearchProvider = {
      name: 'MockFallback',
      async search() {
        return [{ title: 'Fallback hit', url: 'https://fallback.example', description: 'ok' }];
      },
    };

    const tool = createSearchTool(provider, fallbackProvider);
    const result = await tool.execute('tool-2', { query: 'craft', count: 5 });

    expect(result.details?.isError).toBeUndefined();
    expect((result.content[0] as any).text).toContain('automatically fell back to MockFallback');
    expect((result.content[0] as any).text).toContain('401 missing scope');
    expect((result.content[0] as any).text).toContain('https://fallback.example');
  });

  it('marks failures as errors when primary and fallback both fail', async () => {
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error('primary boom');
      },
    };

    const fallbackProvider: WebSearchProvider = {
      name: 'MockFallback',
      async search() {
        throw new Error('fallback boom');
      },
    };

    const tool = createSearchTool(provider, fallbackProvider);
    const result = await tool.execute('tool-3', { query: 'craft', count: -1 });

    expect(result.details?.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('primary (OpenAI) failed');
    expect((result.content[0] as any).text).toContain('fallback (MockFallback) failed');
  });

  it('returns a structured error without contacting an implicit fallback', async () => {
    let calls = 0;
    const provider: WebSearchProvider = {
      name: 'Unavailable',
      async search() {
        calls += 1;
        throw new Error('provider-native search unavailable');
      },
    };

    const tool = createSearchTool(provider);
    const result = await tool.execute('tool-4', { query: 'craft' });

    expect(calls).toBe(1);
    expect(result.details?.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Search failed');
    expect((result.content[0] as any).text).toContain('provider-native search unavailable');
  });
});
