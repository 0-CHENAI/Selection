import { normalizeSearchSettings, type SearchKeyProviderId, type SearchSettings } from '../../../../shared/src/config/search-settings.ts';
import type { WebSearchProvider } from './types.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';
import { DeepSeekSearchProvider } from './providers/deepseek.ts';
import { StandaloneSearchProvider } from './providers/search-apis.ts';

const names = { native: 'Native', deepseek: 'DeepSeek', tavily: 'Tavily', exa: 'Exa', anysearch: 'AnySearch', brave: 'Brave Search' } as const;

/** Resolve the order on every search; fetch a provider key only when it is attempted. */
export function createOrderedProviderResolver(
  readSettings: (signal?: AbortSignal) => Promise<SearchSettings | null>,
  readKey: (provider: SearchKeyProviderId, signal?: AbortSignal) => Promise<string>,
  native: () => WebSearchProvider,
): (signal?: AbortSignal) => Promise<WebSearchProvider[] | null> {
  return async signal => {
    const saved = await readSettings(signal);
    if (saved === null) return null; // Existing users keep native -> AnySearch behavior.
    const settings = normalizeSearchSettings(saved);
    if (!settings) throw new Error('Invalid search settings');
    return settings.providers.filter(item => item.enabled).map(({ id }): WebSearchProvider => ({
      name: id === 'native' ? (native() instanceof AnySearchSearchProvider ? names.native : native().name) : names[id],
      async search(query, count, requestSignal) {
        requestSignal?.throwIfAborted();
        if (id === 'native') {
          const provider = native();
          if (provider instanceof AnySearchSearchProvider) throw new Error('Native search unavailable');
          return provider.search(query, count, requestSignal);
        }
        const key = (await readKey(id, requestSignal)).trim();
        requestSignal?.throwIfAborted();
        if (!key && id !== 'anysearch') throw new Error(`${names[id]} API key is not configured`);
        const provider = id === 'anysearch' ? new AnySearchSearchProvider(key, async () => key)
          : id === 'deepseek' ? new DeepSeekSearchProvider(key)
          : new StandaloneSearchProvider(id, key);
        return provider.search(query, count, requestSignal);
      },
    }));
  };
}
