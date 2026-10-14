import { toPiProviderId } from '../../shared/src/config/pi-provider-ids.ts';

/**
 * Environment the Pi SDK reads a tenant-specific endpoint from.
 *
 * Azure (`azure` after `toPiProviderId`, stored as `azure-openai-responses`)
 * uses `AZURE_OPENAI_BASE_URL`. The API name stays `azure-openai-responses`.
 * Empty for other providers or a blank URL.
 */
export function providerEndpointEnv(
  provider: string | undefined,
  baseUrl: string | undefined,
): Record<string, string> {
  const url = baseUrl?.trim();
  if (!url || !provider || toPiProviderId(provider) !== 'azure') return {};
  return { AZURE_OPENAI_BASE_URL: url };
}

/** Apply or clear the Azure endpoint env var from the active connection. */
export function applyProviderEndpointEnv(provider: string | undefined, baseUrl: string | undefined): void {
  const url = providerEndpointEnv(provider, baseUrl).AZURE_OPENAI_BASE_URL;
  if (url) process.env.AZURE_OPENAI_BASE_URL = url;
  else delete process.env.AZURE_OPENAI_BASE_URL;
}
