/**
 * ORDER gateway identity.
 *
 * Used by setup, storage repair, and settings display so ORDER connections
 * are labeled "ORDER" instead of the generic custom-endpoint name.
 */

export const ORDER_HOST = 'order.ai.jxepdi.top'
export const ORDER_CONNECTION_NAME = 'ORDER'

const GENERIC_CUSTOM_ENDPOINT_NAMES = new Set([
  'Custom Anthropic-Compatible',
  'Custom OpenAI-Compatible',
  'Selection Backend Compatible',
])

export function isOrderGatewayUrl(baseUrl?: string | null): boolean {
  if (!baseUrl?.trim()) return false
  try {
    return new URL(baseUrl).hostname.toLowerCase() === ORDER_HOST
  } catch {
    return baseUrl.toLowerCase().includes(ORDER_HOST)
  }
}

/** OpenAI-compat ORDER base ends with /v1; Anthropic-compat is the origin. */
export function isOrderOpenAiUrl(baseUrl?: string | null): boolean {
  if (!isOrderGatewayUrl(baseUrl)) return false
  return /\/v1\/?$/i.test(baseUrl!.trim())
}

export function isGenericCustomEndpointName(name?: string | null): boolean {
  if (!name) return false
  return GENERIC_CUSTOM_ENDPOINT_NAMES.has(name)
}

/** Stored or display name for an ORDER connection. Keeps a user rename. */
export function displayLlmConnectionName(connection: {
  name: string
  baseUrl?: string | null
}): string {
  if (isOrderGatewayUrl(connection.baseUrl) && isGenericCustomEndpointName(connection.name)) {
    return ORDER_CONNECTION_NAME
  }
  if (isOrderGatewayUrl(connection.baseUrl) && !connection.name.trim()) {
    return ORDER_CONNECTION_NAME
  }
  return connection.name
}
