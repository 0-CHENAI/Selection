/**
 * Official Anthropic API host. Custom Anthropic Messages endpoints must not
 * use this host: that would turn the removed API-key path back on.
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
