import { afterEach, expect, spyOn, test } from 'bun:test';
import { CredentialManager } from '../../credentials/manager.ts';
import { fetchChatGptModels } from '../chatgpt-models.ts';

const mockFetch = () => spyOn(globalThis, 'fetch');
afterEach(() => { mockFetch().mockRestore(); });

test('lists visible account models, including IDs absent from the SDK', async () => {
  const token = `x.${Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: 'account-one' },
  })).toString('base64url')}.x`;
  const fetch = mockFetch().mockResolvedValue(Response.json({ models: [
    { slug: 'reserved', visibility: 'hide' },
    { slug: 'future-model', visibility: 'list', context_window: 400000, input_modalities: ['text'],
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
  ] }));
  expect(await fetchChatGptModels(token, 5000)).toMatchObject([{
    id: 'pi/future-model', contextWindow: 400000, supportsImages: false, supportedThinkingLevels: ['low', 'high'],
  }]);
  const [url, options] = fetch.mock.calls[0]!;
  expect(new URL(String(url)).pathname).toBe('/backend-api/codex/models');
  expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  expect(new Headers(options?.headers).get('ChatGPT-Account-Id')).toBe('account-one');
});

test('distinguishes an empty catalog from invalid data and expired credentials', async () => {
  mockFetch().mockResolvedValue(Response.json({ models: [] }));
  expect(await fetchChatGptModels('opaque', 5000)).toEqual([]);
  mockFetch().mockResolvedValue(Response.json({ models: [{}] }));
  await expect(fetchChatGptModels('opaque', 5000)).rejects.toThrow('Invalid ChatGPT');
  mockFetch().mockResolvedValue(new Response(null, { status: 401 }));
  await expect(fetchChatGptModels('opaque', 5000)).rejects.toThrow('HTTP 401');
});

test('an expired login refreshes once when chat and catalog discovery overlap', async () => {
  const manager = new CredentialManager();
  let stored = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 1, idToken: 'original-id' };
  manager.getLlmOAuth = async () => stored;
  manager.setLlmOAuth = async (_slug, value) => { stored = value as typeof stored; };
  const fetch = mockFetch().mockResolvedValue(Response.json({
    access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600,
  }));
  const results = await Promise.all([manager.getFreshChatGptOAuth('chat'), manager.getFreshChatGptOAuth('chat', 'old')]);
  expect(results.map(result => result?.accessToken)).toEqual(['fresh', 'fresh']);
  expect((await manager.getFreshChatGptOAuth('chat', 'old'))?.refreshToken).toBe('rotated');
  expect(stored.idToken).toBe('original-id');
  expect(fetch).toHaveBeenCalledTimes(1);
});


test('a fresh login proceeds while the previous account refresh is still pending', async () => {
  const manager = new CredentialManager();
  let stored = { accessToken: 'old', refreshToken: 'refresh-one', expiresAt: 1 };
  manager.getLlmOAuth = async () => stored;
  const response = Promise.withResolvers<Response>();
  mockFetch().mockReturnValue(response.promise);
  const old = manager.getFreshChatGptOAuth('chat');
  // Let the first credential read register its in-flight refresh before replacing the login.
  await Promise.resolve();
  stored = { accessToken: 'new', refreshToken: 'refresh-two', expiresAt: Date.now() + 3_600_000 };
  const next = manager.getFreshChatGptOAuth('chat');
  response.resolve(new Response(null, { status: 401 }));
  const [previous, current] = await Promise.allSettled([old, next]);
  expect(previous.status).toBe('rejected');
  expect(current).toEqual({ status: 'fulfilled', value: stored });
});
