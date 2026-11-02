/**
 * Thin adapter around Pi's built-in xAI subscription OAuth provider.
 * Selection owns UI and credential persistence; Pi owns the RFC 8628 device
 * flow, token exchange, and refresh-token rotation.
 */
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { AuthEvent, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';

registerBunOAuthFlows();

/** Pi SDK provider id shared by xAI API-key and SuperGrok OAuth connections. */
export const XAI_PROVIDER_ID = 'xai';

function getXaiOAuth(): OAuthAuth {
  const oauth = builtinProviders().find(provider => provider.id === XAI_PROVIDER_ID)?.auth.oauth;
  if (!oauth) throw new Error('Pi SDK does not provide xAI OAuth');
  return oauth;
}

export interface XaiLoginCallbacks {
  onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export async function loginXaiWithSdk(
  callbacks: XaiLoginCallbacks = {},
): Promise<OAuthCredential> {
  return getXaiOAuth().login({
    signal: callbacks.signal ?? new AbortController().signal,
    prompt: () => Promise.resolve(''),
    notify: (event: AuthEvent) => {
      if (event.type === 'device_code') {
        callbacks.onDeviceCode?.({
          userCode: event.userCode,
          verificationUri: event.verificationUri,
        });
      } else if (event.type === 'progress' || event.type === 'info') {
        callbacks.onProgress?.(event.message);
      }
    },
  });
}

/** Refresh a SuperGrok/X Premium token and preserve any rotated refresh token. */
export async function refreshXaiTokenWithSdk(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  return getXaiOAuth().refresh({
    type: 'oauth',
    access: '',
    refresh: refreshToken,
    expires: 0,
  }, signal ?? new AbortController().signal);
}
