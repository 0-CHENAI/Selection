import { afterEach, describe, expect, it } from 'bun:test';
import { createSearchTool } from './create-search-tool.ts';
import { createOrderedProviderResolver } from './ordered-providers.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';
import { requestSearchSettings } from './search-settings-bridge.ts';
import type { WebSearchProvider } from './types.ts';
import { normalizeSearchSettings } from '../../../../shared/src/config/search-settings.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const native: WebSearchProvider = { name: 'Native model', async search() { throw new Error('unavailable'); } };

describe('search provider configuration', () => {
  it('validates duplicates and appends newly introduced providers as disabled', () => {
    expect(normalizeSearchSettings({ providers: [{ id: 'exa', enabled: true }, { id: 'exa', enabled: false }] })).toBeNull();
    const settings = normalizeSearchSettings({ providers: [{ id: 'exa', enabled: true }] });
    expect(settings?.providers[0]).toEqual({ id: 'exa', enabled: true });
    expect(settings?.providers.filter(p => p.enabled)).toHaveLength(1);
    expect(normalizeSearchSettings({ providers: [{ id: 'bad', enabled: true }] })).toBeNull();
  });

  it('tries providers in order and reads only credentials needed for the search', async () => {
    const keys: string[] = [];
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input).includes('tavily')) return new Response('', { status: 503 });
      return Response.json({ results: [{ title: 'Result', url: 'https://example.com', highlights: ['Excerpt'] }] });
    }) as typeof fetch;
    const resolver = createOrderedProviderResolver(
      async () => ({ providers: [{ id: 'tavily', enabled: true }, { id: 'exa', enabled: true }, { id: 'brave', enabled: true }] }),
      async id => { keys.push(id); return `${id}-key`; }, () => native,
    );
    const result = await createSearchTool(native, undefined, resolver).execute('1', { query: 'test' });
    expect(keys).toEqual(['tavily', 'exa']);
    expect(requests).toEqual(['https://api.tavily.com/search', 'https://api.exa.ai/search']);
    expect((result.content[0] as any).text).toContain('via Exa');
  });

  it('treats an empty result as success and does not try the next provider', async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => { requests.push(String(input)); return Response.json({ results: [] }); }) as typeof fetch;
    const resolver = createOrderedProviderResolver(async () => ({ providers: [{ id: 'tavily', enabled: true }, { id: 'exa', enabled: true }] }), async () => 'key', () => native);
    const result = await createSearchTool(native, undefined, resolver).execute('1', { query: 'no matches' });
    expect(requests).toHaveLength(1);
    expect((result.content[0] as any).text).toContain('No relevant results');
  });

  it('does not silently use AnySearch when native search is unavailable and AnySearch is disabled', async () => {
    let fetched = false;
    globalThis.fetch = (async () => { fetched = true; return Response.json({}); }) as typeof fetch;
    const resolver = createOrderedProviderResolver(async () => ({ providers: [{ id: 'native', enabled: true }] }), async () => '', () => new AnySearchSearchProvider());
    const result = await createSearchTool(native, undefined, resolver).execute('1', { query: 'private' });
    expect(result.details?.isError).toBe(true);
    expect(fetched).toBe(false);
  });

  it('keeps legacy behavior when settings are absent and stops on cancellation', async () => {
    const resolver = createOrderedProviderResolver(async () => null, async () => '', () => native);
    expect(await resolver()).toBeNull();
    const controller = new AbortController();
    let fallbackCalled = false;
    const first: WebSearchProvider = { name: 'first', async search() { controller.abort(); throw new Error('stopped'); } };
    const second: WebSearchProvider = { name: 'second', async search() { fallbackCalled = true; return []; } };
    await expect(createSearchTool(native, undefined, async () => [first, second]).execute('1', { query: 'test' }, controller.signal)).rejects.toThrow();
    expect(fallbackCalled).toBe(false);
  });

  it('fails closed when settings are unavailable', async () => {
    let called = false;
    const fallback: WebSearchProvider = { name: 'fallback', async search() { called = true; return []; } };
    const result = await createSearchTool(fallback, undefined, async () => { throw new Error('bridge failed'); }).execute('1', { query: 'test' });
    expect(result.details?.isError).toBe(true);
    expect(called).toBe(false);
  });
});

describe('settings bridge', () => {
  it('removes pending requests on timeout and cancellation', async () => {
    const pending = new Map();
    await expect(requestSearchSettings(() => {}, pending, undefined, undefined, 1)).rejects.toThrow('timed out');
    expect(pending.size).toBe(0);
    const controller = new AbortController();
    const request = requestSearchSettings(() => {}, pending, 'exa', controller.signal);
    controller.abort();
    await expect(request).rejects.toThrow();
    expect(pending.size).toBe(0);
  });
});
