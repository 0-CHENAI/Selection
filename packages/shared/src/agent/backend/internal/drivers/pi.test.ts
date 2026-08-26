import { describe, expect, it } from 'bun:test';
import { piDriver } from './pi.ts';

describe('piDriver.buildRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'vision-model',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'anthropic-messages', supportsImages: true },
          models: [
            { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
            { id: 'text-only-model', supportsImages: false },
            { id: 'plain-model' },
          ],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
      { id: 'text-only-model', supportsImages: false },
      'plain-model',
    ]);
  });

  it('forwards stored maxTokens onto customModels', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'vision-model',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'openai-completions' },
          models: [
            { id: 'vision-model', contextWindow: 262_144, maxTokens: 32_768 },
          ],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, maxTokens: 32_768 },
    ]);
  });

  it('does not persist inferred vision flags onto customModels', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'Opus',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi_compat',
          authType: 'api_key_with_endpoint',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'openai-completions' },
          models: ['Opus', 'Laufry'],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual(['Opus', 'Laufry']);
  });
});

describe('piDriver.fetchModels OpenRouter', () => {
  it('uses the live OpenRouter catalog when the request succeeds', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/models');
      return new Response(JSON.stringify({
        data: [{
          id: 'openai/gpt-brand-new',
          name: 'OpenAI: GPT Brand New',
          context_length: 200000,
          pricing: { prompt: '0.000001', completion: '0.000002' },
          architecture: { output_modalities: ['text'] },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    try {
      const result = await piDriver.fetchModels!({
        connection: {
          slug: 'openrouter',
          name: 'OpenRouter',
          providerType: 'pi',
          authType: 'api_key',
          piAuthProvider: 'openrouter',
          createdAt: Date.now(),
        } as any,
        credentials: { apiKey: 'sk-or-test' },
        timeoutMs: 5_000,
        hostRuntime: {} as never,
        resolvedPaths: {} as never,
      });

      expect(result.models).toEqual([
        expect.objectContaining({
          id: 'pi/openai/gpt-brand-new',
          name: 'OpenAI: GPT Brand New',
          provider: 'pi',
          contextWindow: 200000,
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to the Pi SDK snapshot when the live catalog fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    try {
      const result = await piDriver.fetchModels!({
        connection: {
          slug: 'openrouter',
          name: 'OpenRouter',
          providerType: 'pi',
          authType: 'api_key',
          piAuthProvider: 'openrouter',
          createdAt: Date.now(),
        } as any,
        credentials: { apiKey: 'sk-or-test' },
        timeoutMs: 5_000,
        hostRuntime: {} as never,
        resolvedPaths: {} as never,
      });

      expect(result.models.some((model) => model.id === 'pi/openrouter/auto')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('piDriver.testConnection custom endpoints', () => {
  it('probes GET /v1/models instead of posting /v1/messages for ORDER-style gateways', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: 'DeepSeek-V4-Flash' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const result = await piDriver.testConnection!({
        provider: 'pi',
        apiKey: 'sk-test',
        model: 'DeepSeek-V4-Flash',
        baseUrl: 'https://order.ai.jxepdi.top',
        timeoutMs: 5_000,
        connection: {
          providerType: 'pi_compat',
          customEndpoint: { api: 'anthropic-messages' },
          piAuthProvider: 'anthropic',
        },
        hostRuntime: {} as never,
        resolvedPaths: {} as never,
      });

      expect(result).toEqual({ success: true });
      expect(urls).toEqual(['https://order.ai.jxepdi.top/v1/models']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not double /v1 when the ORDER OpenAI base already ends with /v1', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await piDriver.testConnection!({
        provider: 'pi',
        apiKey: 'sk-test',
        model: 'DeepSeek-V4-Flash',
        baseUrl: 'https://order.ai.jxepdi.top/v1',
        timeoutMs: 5_000,
        connection: {
          providerType: 'pi_compat',
          customEndpoint: { api: 'openai-completions' },
          piAuthProvider: 'openai',
        },
        hostRuntime: {} as never,
        resolvedPaths: {} as never,
      });

      expect(result).toEqual({ success: true });
      expect(urls).toEqual(['https://order.ai.jxepdi.top/v1/models']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
