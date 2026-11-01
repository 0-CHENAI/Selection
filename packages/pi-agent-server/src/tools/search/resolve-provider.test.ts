import { describe, expect, it } from 'bun:test';
import {
  createDynamicSearchProvider,
  requestAnySearchApiKey,
  resolveSearchProvider,
  type SearchProviderAuthConfig,
} from './resolve-provider.ts';
import { AnySearchSearchProvider } from './providers/anysearch.ts';
import { AnthropicSearchProvider } from './providers/anthropic.ts';
import { ChatGPTBackendSearchProvider } from './providers/chatgpt.ts';
import { DeepSeekSearchProvider } from './providers/deepseek.ts';
import { GoogleSearchProvider } from './providers/google.ts';
import { KimiSearchProvider } from './providers/kimi.ts';
import { ResponsesApiSearchProvider } from './providers/openai.ts';

function makeJwt(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('resolveSearchProvider', () => {
  it('defaults to AnySearch without an LLM connection', () => {
    expect(resolveSearchProvider()).toBeInstanceOf(AnySearchSearchProvider);
    expect(resolveSearchProvider().name).toBe('AnySearch');
  });

  it('prefers ChatGPT native search for openai-codex bearer tokens', () => {
    const accessToken = makeJwt('acc_native');

    expect(resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'api_key', key: accessToken },
    }, 'gpt-6.1-sol')).toBeInstanceOf(ChatGPTBackendSearchProvider);

    expect(resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'oauth', access: accessToken, refresh: '', expires: 0 },
    })).toBeInstanceOf(ChatGPTBackendSearchProvider);
  });

  it('selects official native search only for exact built-in provider ids', () => {
    expect(resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: 'sk-openai' },
    }, 'pi/gpt-6.1-sol')).toBeInstanceOf(ResponsesApiSearchProvider);

    expect(resolveSearchProvider({
      provider: 'anthropic',
      credential: { type: 'api_key', key: 'sk-ant-api' },
    }, 'pi/claude-sonnet-4-6')).toBeInstanceOf(AnthropicSearchProvider);

    expect(resolveSearchProvider({
      provider: 'deepseek',
      credential: { type: 'api_key', key: 'sk-deepseek' },
    })).toBeInstanceOf(DeepSeekSearchProvider);

    expect(resolveSearchProvider({
      provider: 'google',
      credential: { type: 'api_key', key: 'AIza-google' },
    })).toBeInstanceOf(GoogleSearchProvider);

    expect(resolveSearchProvider({
      provider: 'moonshotai',
      credential: { type: 'api_key', key: 'sk-moonshot' },
    })).toBeInstanceOf(KimiSearchProvider);

    expect(resolveSearchProvider({
      provider: 'moonshotai-cn',
      credential: { type: 'api_key', key: 'sk-moonshot-cn' },
    })).toBeInstanceOf(KimiSearchProvider);
  });

  it('keeps custom endpoints and incompatible credentials isolated on AnySearch', () => {
    expect(resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: 'custom-endpoint-secret' },
    }, undefined, undefined, { customEndpoint: true })).toBeInstanceOf(AnySearchSearchProvider);

    expect(resolveSearchProvider({
      provider: 'openai',
      credential: { type: 'api_key', key: 'legacy-custom-secret' },
    }, undefined, undefined, {
      baseUrl: 'https://api.openai.com.evil.example/v1',
    })).toBeInstanceOf(AnySearchSearchProvider);

    expect(resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'api_key', key: makeJwt('acc_custom') },
    }, undefined, undefined, { customEndpoint: true })).toBeInstanceOf(AnySearchSearchProvider);

    expect(resolveSearchProvider({
      provider: 'deepseek',
      credential: { type: 'api_key', key: 'oauth-access-token' },
    }, undefined, undefined, { authType: 'oauth' })).toBeInstanceOf(AnySearchSearchProvider);

    expect(resolveSearchProvider({
      provider: 'anthropic',
      credential: { type: 'api_key', key: 'sk-ant-oat-subscription-token' },
    })).toBeInstanceOf(AnySearchSearchProvider);

    expect(resolveSearchProvider({
      provider: 'kimi-coding',
      credential: { type: 'oauth', access: 'kimi-code-token', refresh: '', expires: 0 },
    })).toBeInstanceOf(AnySearchSearchProvider);

    expect(resolveSearchProvider({
      provider: 'openai-codex',
      credential: { type: 'api_key', key: 'malformed-token' },
    })).toBeInstanceOf(AnySearchSearchProvider);
  });

  it('resolves the latest ChatGPT token without recreating the provider', async () => {
    let auth: SearchProviderAuthConfig | undefined;
    const seenAuthorization: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenAuthorization.push((init?.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'Result',
            annotations: [{ type: 'url_citation', url: 'https://example.com', title: 'Example' }],
          }],
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const provider = createDynamicSearchProvider(() => auth, () => 'gpt-6.1-sol');
      expect(provider.name).toBe('AnySearch');

      const firstToken = makeJwt('acc_first');
      auth = { provider: 'openai-codex', credential: { type: 'api_key', key: firstToken } };
      expect(provider.name).toBe('ChatGPT');
      await provider.search('first', 1);

      const refreshedToken = makeJwt('acc_refreshed');
      auth = { provider: 'openai-codex', credential: { type: 'api_key', key: refreshedToken } };
      await provider.search('second', 1);

      expect(seenAuthorization).toEqual([
        `Bearer ${firstToken}`,
        `Bearer ${refreshedToken}`,
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it('cancels a pending AnySearch key request immediately', async () => {
    const pending = new Map<string, (apiKey: string) => void>();
    const controller = new AbortController();
    const result = requestAnySearchApiKey(() => {}, pending, 5_000, controller.signal);
    expect(pending.size).toBe(1);

    controller.abort(new DOMException('cancelled', 'AbortError'));

    let rejected = false;
    try {
      await result;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(pending.size).toBe(0);
  });
});
