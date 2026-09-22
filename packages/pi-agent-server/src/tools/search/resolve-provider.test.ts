import { describe, expect, it } from 'bun:test';
import { requestAnySearchApiKey, resolveSearchProvider } from './resolve-provider.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';

describe('resolveSearchProvider', () => {
  it('defaults to AnySearch without an LLM connection', () => {
    expect(resolveSearchProvider()).toBeInstanceOf(AnySearchSearchProvider);
    expect(resolveSearchProvider().name).toBe('AnySearch');
  });

  it('accepts only an optional search-key resolver, never an LLM credential', () => {
    expect(resolveSearchProvider.length).toBe(1);
  });

  it('returns the current settings key and times out to anonymous access', async () => {
    const pending = new Map<string, (apiKey: string) => void>();
    const sent: Array<{ id: string }> = [];
    const pendingResult = requestAnySearchApiKey(message => sent.push(message), pending);
    expect(sent).toHaveLength(1);
    pending.get(sent[0]!.id)?.('settings-key');
    expect(await pendingResult).toBe('settings-key');

    const timedOut = requestAnySearchApiKey(() => {}, new Map(), 1);
    expect(await timedOut).toBe('');
  });
});
