/**
 * refresh() runs one refresh per stored credential at a time. The key is the workspace +
 * slug, like the credential itself: two workspaces may each have a source with the same
 * slug and must never share a refresh (or receive each other's token).
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { SourceCredentialManager } from '../credential-manager.ts';
import type { LoadedSource } from '../types.ts';

function source(workspaceId: string, slug = 'gmail'): LoadedSource {
  return {
    config: {
      id: `${workspaceId}-${slug}`,
      name: slug,
      slug,
      enabled: true,
      provider: 'google',
      type: 'api',
      isAuthenticated: true,
      api: { baseUrl: 'https://gmail.googleapis.com', authType: 'oauth' },
    },
    guide: null,
    folderPath: `/mock/${workspaceId}/sources/${slug}`,
    workspaceRootPath: `/mock/${workspaceId}`,
    workspaceId,
  } as LoadedSource;
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

/** Stub the provider round trip: each refresh resolves when its workspace's gate opens. */
function stubRefresh(credManager: SourceCredentialManager) {
  const calls: string[] = [];
  const gates = new Map<string, () => void>();
  const spy = spyOn(credManager as unknown as { doRefresh: (s: LoadedSource) => Promise<string | null> }, 'doRefresh')
    .mockImplementation((s: LoadedSource) => {
      calls.push(s.workspaceId);
      return new Promise<string | null>(resolve => {
        gates.set(s.workspaceId, () => resolve(`token-for-${s.workspaceId}`));
      });
    });
  restore = () => spy.mockRestore();
  return { calls, open: (workspaceId: string) => gates.get(workspaceId)!() };
}

describe('SourceCredentialManager.refresh single flight', () => {
  test('concurrent refreshes of one workspace source share a single provider call', async () => {
    const credManager = new SourceCredentialManager();
    const { calls, open } = stubRefresh(credManager);

    const first = credManager.refresh(source('ws-1'));
    const second = credManager.refresh(source('ws-1'));
    await Promise.resolve();
    open('ws-1');

    expect(await first).toBe('token-for-ws-1');
    expect(await second).toBe('token-for-ws-1');
    expect(calls).toEqual(['ws-1']);
  });

  test('the same slug in two workspaces refreshes separately and gets its own token', async () => {
    const credManager = new SourceCredentialManager();
    const { calls, open } = stubRefresh(credManager);

    const inWs1 = credManager.refresh(source('ws-1'));
    const inWs2 = credManager.refresh(source('ws-2'));
    await Promise.resolve();
    open('ws-2');
    open('ws-1');

    expect(await inWs1).toBe('token-for-ws-1');
    expect(await inWs2).toBe('token-for-ws-2');
    expect(calls).toEqual(['ws-1', 'ws-2']);
  });

  test('a finished refresh does not absorb the next one', async () => {
    const credManager = new SourceCredentialManager();
    const { calls, open } = stubRefresh(credManager);

    const first = credManager.refresh(source('ws-1'));
    await Promise.resolve();
    open('ws-1');
    await first;

    const second = credManager.refresh(source('ws-1'));
    await Promise.resolve();
    open('ws-1');
    await second;

    expect(calls).toEqual(['ws-1', 'ws-1']);
  });
});
