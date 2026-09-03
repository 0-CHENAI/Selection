/**
 * Resolve the app-level theme after config.json has been read.
 *
 * The cached value is only a fast startup fallback. Once the config value is
 * available it is authoritative, including when it explicitly selects the
 * built-in `default` theme.
 */
function normalizeColorTheme(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function resolveStartupColorTheme(
  configuredTheme: unknown,
  cachedTheme: unknown,
  defaultTheme = 'default',
): string {
  return normalizeColorTheme(configuredTheme)
    ?? normalizeColorTheme(cachedTheme)
    ?? normalizeColorTheme(defaultTheme)
    ?? 'default'
}
