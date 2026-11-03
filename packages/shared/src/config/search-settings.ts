/** App-level search ordering. Secrets are stored separately in credentials. */
export const SEARCH_PROVIDER_IDS = ['native', 'deepseek', 'tavily', 'exa', 'anysearch', 'brave'] as const;
export type SearchProviderId = typeof SEARCH_PROVIDER_IDS[number];
export type SearchKeyProviderId = Exclude<SearchProviderId, 'native'>;
export interface SearchProviderSetting { id: SearchProviderId; enabled: boolean }
export interface SearchSettings { providers: SearchProviderSetting[] }

export function defaultSearchSettings(): SearchSettings {
  return { providers: SEARCH_PROVIDER_IDS.map(id => ({ id, enabled: id === 'native' || id === 'anysearch' })) };
}

export function isSearchProviderId(value: unknown): value is SearchProviderId {
  return typeof value === 'string' && (SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Strict at the write boundary, tolerant when new providers are added later. */
export function normalizeSearchSettings(value: unknown): SearchSettings | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as SearchSettings).providers)) return null;
  const providers: SearchProviderSetting[] = [];
  const seen = new Set<SearchProviderId>();
  for (const entry of (value as SearchSettings).providers) {
    if (!entry || !isSearchProviderId(entry.id) || typeof entry.enabled !== 'boolean' || seen.has(entry.id)) return null;
    seen.add(entry.id);
    providers.push({ id: entry.id, enabled: entry.enabled });
  }
  for (const id of SEARCH_PROVIDER_IDS) if (!seen.has(id)) providers.push({ id, enabled: false });
  return { providers };
}
