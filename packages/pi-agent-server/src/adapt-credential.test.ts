import { describe, expect, it } from 'bun:test';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { adaptCredentialForPiSdk, syncCredentialForPiSdk } from './adapt-credential.ts';

describe('adaptCredentialForPiSdk', () => {
  it('rewraps OAuth-only provider bearer tokens for Pi credential resolution', () => {
    expect(adaptCredentialForPiSdk('openai-codex', { type: 'api_key', key: 'bearer' })).toEqual({
      type: 'oauth',
      access: 'bearer',
      refresh: '',
      expires: Number.MAX_SAFE_INTEGER,
    });
  });

  it('does not store Bedrock IAM credentials that must resolve from environment', () => {
    expect(adaptCredentialForPiSdk('amazon-bedrock', {
      type: 'iam',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    })).toBeNull();
  });

  it('passes ordinary API keys through unchanged', () => {
    const credential = { type: 'api_key' as const, key: 'sk-test' };
    expect(adaptCredentialForPiSdk('openai', credential)).toEqual(credential);
  });

  it('stores adapted bearer credentials through the shared synchronization path', async () => {
    const store = new InMemoryCredentialStore();

    expect(await syncCredentialForPiSdk(
      store,
      'openai-codex',
      { type: 'api_key', key: 'bearer' },
    )).toBe('stored');
    expect(await store.read('openai-codex')).toEqual({
      type: 'oauth',
      access: 'bearer',
      refresh: '',
      expires: Number.MAX_SAFE_INTEGER,
    });
  });

  it('removes a stale stored credential before switching to ambient IAM', async () => {
    const store = new InMemoryCredentialStore();
    await store.modify('amazon-bedrock', async () => ({ type: 'api_key', key: 'stale' }));

    expect(await syncCredentialForPiSdk(store, 'amazon-bedrock', {
      type: 'iam',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
    })).toBe('ambient');
    expect(await store.read('amazon-bedrock')).toBeUndefined();
  });
});
