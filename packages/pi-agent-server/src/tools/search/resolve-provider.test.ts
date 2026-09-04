import { describe, expect, it } from 'bun:test';
import { resolveSearchProvider } from './resolve-provider.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';

describe('resolveSearchProvider', () => {
  it('defaults to AnySearch without an LLM connection', () => {
    expect(resolveSearchProvider()).toBeInstanceOf(AnySearchSearchProvider);
    expect(resolveSearchProvider().name).toBe('AnySearch');
  });

  it('accepts no LLM credential input by design', () => {
    expect(resolveSearchProvider.length).toBe(0);
  });
});
