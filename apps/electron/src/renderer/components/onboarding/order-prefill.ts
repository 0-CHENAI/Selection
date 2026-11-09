/**
 * ORDER welcome-card prefill.
 *
 * The dedicated ORDER page (wordmark, no provider dropdown) is selected only
 * when these values reach the credentials form. Without them the form falls
 * through to the generic API setup page.
 */
export function isOrderCredentialPrefill(
  values?: { activePreset?: string; baseUrl?: string | null } | null,
): boolean {
  if (!values) return false
  return values.activePreset === 'order-openai'
    || (values.baseUrl?.includes('order.ai.jxepdi.top') ?? false)
}
