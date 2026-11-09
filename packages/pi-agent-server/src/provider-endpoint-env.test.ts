import { afterEach, describe, expect, it } from 'bun:test';
import { applyProviderEndpointEnv, providerEndpointEnv } from './provider-endpoint-env.ts';

const ENV_KEY = 'AZURE_OPENAI_BASE_URL';
const previous = process.env[ENV_KEY];

afterEach(() => {
  if (previous === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previous;
});

describe('Azure endpoint env', () => {
  it('maps the stored Azure provider id onto AZURE_OPENAI_BASE_URL', () => {
    expect(providerEndpointEnv('azure-openai-responses', ' https://res.openai.azure.com ')).toEqual({
      AZURE_OPENAI_BASE_URL: 'https://res.openai.azure.com',
    });
    expect(providerEndpointEnv('azure', 'https://res.openai.azure.com')).toEqual({
      AZURE_OPENAI_BASE_URL: 'https://res.openai.azure.com',
    });
  });

  it('leaves other providers and blank URLs alone', () => {
    expect(providerEndpointEnv('openai', 'https://api.openai.com')).toEqual({});
    expect(providerEndpointEnv('azure-openai-responses', '  ')).toEqual({});
    expect(providerEndpointEnv(undefined, 'https://res.openai.azure.com')).toEqual({});
  });

  it('replaces a previous Azure endpoint and clears it for other providers', () => {
    applyProviderEndpointEnv('azure-openai-responses', 'https://old.openai.azure.com');
    expect(process.env[ENV_KEY]).toBe('https://old.openai.azure.com');

    applyProviderEndpointEnv('azure', 'https://new.openai.azure.com');
    expect(process.env[ENV_KEY]).toBe('https://new.openai.azure.com');

    applyProviderEndpointEnv('openai', 'https://api.openai.com');
    expect(process.env[ENV_KEY]).toBeUndefined();
  });
});
