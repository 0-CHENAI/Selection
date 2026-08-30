/**
 * Thin adapter around Pi's built-in GitHub Copilot OAuth provider.
 * Selection owns UI and credential persistence; Pi continues to own the OAuth
 * protocol, token exchange, and provider-specific behavior.
 */
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { AuthEvent, AuthPrompt, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';

registerBunOAuthFlows();

function getGitHubCopilotOAuth(): OAuthAuth {
  const oauth = builtinProviders().find(provider => provider.id === 'github-copilot')?.auth.oauth;
  if (!oauth) throw new Error('Pi SDK does not provide GitHub Copilot OAuth');
  return oauth;
}

export interface GitHubCopilotLoginCallbacks {
  onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void;
  onPrompt?: (prompt: AuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export async function loginGitHubCopilotWithSdk(
  callbacks: GitHubCopilotLoginCallbacks = {},
): Promise<OAuthCredential> {
  return getGitHubCopilotOAuth().login({
    signal: callbacks.signal,
    prompt: prompt => callbacks.onPrompt?.(prompt) ?? Promise.resolve(''),
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

export async function refreshGitHubCopilotTokenWithSdk(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  return getGitHubCopilotOAuth().refresh({
    type: 'oauth',
    access: '',
    refresh: refreshToken,
    expires: 0,
  }, signal);
}
