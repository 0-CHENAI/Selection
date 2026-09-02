import { describe, expect, it } from 'bun:test';
import { resolveSearchProvider } from './resolve-provider.ts';
import { ResponsesApiSearchProvider } from './providers/openai.ts';
import { ChatGPTBackendSearchProvider } from './providers/chatgpt.ts';
import { GoogleSearchProvider } from './providers/google.ts';
import { UnavailableSearchProvider } from './providers/unavailable.ts';
import { createSearchTool } from './create-search-tool.ts';

/** Build a minimal JWT with a chatgpt_account_id claim. */
function makeJwt(accountId: string): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    }),
  );
  return `${header}.${payload}.fakesig`;
}

describe('resolveSearchProvider', () => {
  // --- OpenAI (API key) ---

  it('selects ResponsesApiSearchProvider for openai + api_key', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: 'sk-test' },
    });

    expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
    expect(provider.name).toBe('OpenAI');
  });

  // --- ChatGPT Plus (OAuth) ---

  it('selects ChatGPTBackendSearchProvider for openai-codex + oauth with valid JWT', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: {
        type: 'oauth',
        access: makeJwt('acc_123'),
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(ChatGPTBackendSearchProvider);
    expect(provider.name).toBe('ChatGPT');
  });

  it('selects ChatGPTBackendSearchProvider for openai-codex + api_key with valid JWT token', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'api_key', key: makeJwt('acc_999') },
    });

    expect(provider).toBeInstanceOf(ChatGPTBackendSearchProvider);
    expect(provider.name).toBe('ChatGPT');
  });

  it('returns unavailable for openai-codex + oauth with malformed JWT', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: {
        type: 'oauth',
        access: 'not-a-jwt',
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(UnavailableSearchProvider);
  });

  it('returns unavailable for openai-codex + api_key with malformed non-JWT token', () => {
    const provider = resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'api_key', key: 'not-a-jwt' },
    });

    expect(provider).toBeInstanceOf(UnavailableSearchProvider);
  });

  // --- OpenRouter ---

  it('selects ResponsesApiSearchProvider for openrouter + api_key', () => {
    const provider = resolveSearchProvider({
      provider: 'openrouter',
      credential: { type: 'api_key', key: 'sk-or-test' },
    });

    expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
    expect(provider.name).toBe('OpenRouter');
  });

  // --- Google ---

  it('selects Google provider for google + api_key', () => {
    const provider = resolveSearchProvider({
      provider: 'google',
      credential: { type: 'api_key', key: 'g-test' },
    });

    expect(provider).toBeInstanceOf(GoogleSearchProvider);
  });

  // --- Unsupported connection cases ---

  it('returns unavailable for openai + oauth (no ChatGPT backend for plain openai)', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: {
        type: 'oauth',
        access: 'a',
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(UnavailableSearchProvider);
  });

  it('returns unavailable when provider is unknown', () => {
    const provider = resolveSearchProvider({
      provider: 'unknown',
      credential: { type: 'api_key', key: 'x' },
    });

    expect(provider).toBeInstanceOf(UnavailableSearchProvider);
  });

  it('returns unavailable when key is empty', () => {
    const provider = resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: '' },
    });

    expect(provider).toBeInstanceOf(UnavailableSearchProvider);
  });

  it('returns unavailable when no piAuth is provided', () => {
    expect(resolveSearchProvider()).toBeInstanceOf(UnavailableSearchProvider);
    expect(resolveSearchProvider(undefined)).toBeInstanceOf(UnavailableSearchProvider);
  });

  it('returns a structured tool error instead of using an implicit network fallback', async () => {
    const tool = createSearchTool(resolveSearchProvider());
    const result = await tool.execute('tool-unavailable', { query: 'private query' });

    expect(result.details?.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('no configured provider-native search support');
  });

  it('returns unavailable for github-copilot (no search API available)', () => {
    const provider = resolveSearchProvider({
      provider: 'github-copilot',
      credential: {
        type: 'oauth',
        access: 'ghu_token',
        refresh: 'r',
        expires: Date.now() + 60_000,
      },
    });

    expect(provider).toBeInstanceOf(UnavailableSearchProvider);
  });

  it('returns unavailable for vercel-ai-gateway (not yet wired for provider-native search)', () => {
    const provider = resolveSearchProvider({
      provider: 'vercel-ai-gateway',
      credential: { type: 'api_key', key: 'vercel-test-key' },
    });

    expect(provider).toBeInstanceOf(UnavailableSearchProvider);
  });
});
