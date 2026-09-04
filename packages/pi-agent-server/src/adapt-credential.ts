import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type {
  Credential as PiSdkCredential,
  CredentialStore as PiSdkCredentialStore,
} from '@earendil-works/pi-ai';

/** Credential union used in init and token_update messages from the main process. */
export type PiCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: 'iam'; accessKeyId: string; secretAccessKey: string; region?: string; sessionToken?: string };

let oauthOnlyProviderIdsCache: Set<string> | null = null;

function oauthOnlyProviderIds(): Set<string> {
  if (!oauthOnlyProviderIdsCache) {
    oauthOnlyProviderIdsCache = new Set(
      builtinProviders()
        .filter(provider => provider.auth.oauth && !provider.auth.apiKey)
        .map(provider => provider.id),
    );
  }
  return oauthOnlyProviderIdsCache;
}

/**
 * Adapt Selection's wire credential to Pi's typed store. OAuth bearer tokens
 * arrive over the wire in api_key form, while IAM remains ambient via AWS env.
 */
export function adaptCredentialForPiSdk(
  provider: string,
  credential: PiCredential,
): PiSdkCredential | null {
  if (credential.type === 'api_key' && oauthOnlyProviderIds().has(provider)) {
    return { type: 'oauth', access: credential.key, refresh: '', expires: Number.MAX_SAFE_INTEGER };
  }
  if (credential.type === 'iam') return null;
  return credential as PiSdkCredential;
}

/**
 * Synchronize one wire credential into Pi's store. Ambient credentials must
 * delete any previously stored value because stored credentials take priority
 * over environment/provider-chain resolution in the Pi runtime.
 */
export async function syncCredentialForPiSdk(
  store: PiSdkCredentialStore,
  provider: string,
  credential: PiCredential,
): Promise<'stored' | 'ambient'> {
  const adapted = adaptCredentialForPiSdk(provider, credential);
  if (adapted) {
    await store.modify(provider, async () => adapted);
    return 'stored';
  }

  await store.delete(provider);
  return 'ambient';
}
