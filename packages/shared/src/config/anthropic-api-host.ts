/**
 * Anthropic's own Messages host. Custom endpoints on this host use `x-api-key`.
 * Every other host is a third-party gateway and keeps Bearer auth.
 */
export function isOfficialAnthropicApiUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const hostname = new URL(value.trim()).hostname.replace(/\.+$/, '').toLowerCase();
    return hostname === 'api.anthropic.com';
  } catch {
    return false;
  }
}
