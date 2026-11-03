import type { SearchKeyProviderId, SearchSettings } from '../../../../shared/src/config/search-settings.ts';

export type SearchSettingsRequest = { type: 'search_settings_request'; id: string; provider?: SearchKeyProviderId };
export type SearchSettingsResponse = { type: 'search_settings_result'; id: string; settings?: SearchSettings | null; apiKey?: string; error?: string };

export function requestSearchSettings(
  send: (message: SearchSettingsRequest) => void,
  pending: Map<string, (response: SearchSettingsResponse) => void>,
  provider?: SearchKeyProviderId,
  signal?: AbortSignal,
  timeoutMs = 5000,
): Promise<SearchSettingsResponse> {
  const id = `search-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const cleanup = () => { clearTimeout(timer); pending.delete(id); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Search settings request timed out')); }, timeoutMs);
    pending.set(id, response => { cleanup(); response.error ? reject(new Error(response.error)) : resolve(response); });
    signal?.addEventListener('abort', onAbort, { once: true });
    try { send({ type: 'search_settings_request', id, ...(provider ? { provider } : {}) }); }
    catch (error) { cleanup(); reject(error); }
  });
}
