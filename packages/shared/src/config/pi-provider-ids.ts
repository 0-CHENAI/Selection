/**
 * Selection ↔ Pi SDK provider ids.
 *
 * Selection keeps the provider ids it persists on LLM connections
 * (`LlmConnection.piAuthProvider`, the API-key presets) and translates them
 * where they cross into the Pi SDK, so an upstream rename never needs a config
 * migration and a downgrade keeps working.
 *
 * - `azure-openai-responses` → `azure` (Pi 1.0.3). Only the provider id moved;
 *   the API name `azure-openai-responses` and the `AZURE_OPENAI_*` env vars are
 *   unchanged.
 *
 * Pure (no Pi imports) so the Pi subprocess and renderer-safe code can use it.
 */
const SELECTION_TO_PI_PROVIDER_ID: Readonly<Record<string, string>> = {
  'azure-openai-responses': 'azure',
};

const PI_TO_SELECTION_PROVIDER_ID: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SELECTION_TO_PI_PROVIDER_ID).map(([selectionId, piId]) => [piId, selectionId]),
);

/** The Pi SDK provider id for a provider id Selection stores. */
export function toPiProviderId(selectionProviderId: string): string {
  return SELECTION_TO_PI_PROVIDER_ID[selectionProviderId] ?? selectionProviderId;
}

/**
 * Provider id used inside the Pi subprocess.
 *
 * A custom Anthropic Messages endpoint keeps `piAuthProvider: 'anthropic'` on
 * the saved connection (auth hint and icon). The subprocess must not use that
 * id: Pi would store the key on the built-in Anthropic provider and model
 * lookup could fall through to api.anthropic.com.
 */
export function piRuntimeProviderId(selectionProviderId: string, customEndpointApi?: string): string {
  const sdkProvider = toPiProviderId(selectionProviderId);
  if (sdkProvider === 'anthropic' && customEndpointApi === 'anthropic-messages') return 'custom-endpoint';
  return sdkProvider;
}

/** The provider id Selection stores for a Pi SDK provider id. */
export function fromPiProviderId(piProviderId: string): string {
  return PI_TO_SELECTION_PROVIDER_ID[piProviderId] ?? piProviderId;
}
