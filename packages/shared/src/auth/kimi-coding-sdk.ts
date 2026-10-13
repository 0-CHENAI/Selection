/**
 * Thin adapter around Pi's built-in Kimi Code (subscription) OAuth provider.
 * Selection owns UI and credential persistence; Pi continues to own the OAuth
 * protocol (RFC 8628 device authorization against auth.kimi.com), token
 * exchange, and refresh.
 */
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { AuthEvent, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';

registerBunOAuthFlows();

/** Pi SDK provider id for Kimi Code. */
export const KIMI_CODING_PROVIDER_ID = 'kimi-coding';

function getKimiCodingOAuth(): OAuthAuth {
  const oauth = builtinProviders().find(provider => provider.id === KIMI_CODING_PROVIDER_ID)?.auth.oauth;
  if (!oauth) throw new Error('Pi SDK does not provide Kimi Code OAuth');
  return oauth;
}

export interface KimiCodingLoginCallbacks {
  onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export async function loginKimiCodingWithSdk(
  callbacks: KimiCodingLoginCallbacks = {},
): Promise<OAuthCredential> {
  return getKimiCodingOAuth().login({
    signal: callbacks.signal ?? new AbortController().signal,
    // Kimi's device flow never prompts; answer defensively if a future SDK does.
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

/**
 * Exchange a Kimi refresh token for a fresh access token. Kimi may rotate the
 * refresh token, so callers must persist the returned `refresh` value.
 */
export async function refreshKimiCodingTokenWithSdk(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  return getKimiCodingOAuth().refresh({
    type: 'oauth',
    access: '',
    refresh: refreshToken,
    expires: 0,
  }, signal ?? new AbortController().signal);
}
