export function collectSourceSyncFailures(failures: unknown): string[] {
  if (!Array.isArray(failures)) return []
  return [...new Set(failures.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0))]
}

/**
 * Emit a user-visible notice only the first time a slug fails.
 * Recovered slugs drop out of `notified` so a later failure can warn again.
 */
export function nextSourceSyncNotices(notified: Set<string>, current: readonly string[]): string[] {
  for (const slug of [...notified]) {
    if (!current.includes(slug)) notified.delete(slug)
  }
  const fresh: string[] = []
  for (const slug of current) {
    if (notified.has(slug)) continue
    notified.add(slug)
    fresh.push(slug)
  }
  return fresh
}

export function sourceSyncModelReminder(slugs: readonly string[]): string {
  if (!slugs.length) return ''
  return `<system-reminder>The following sources failed to connect and their tools are unavailable: ${slugs.join(', ')}. Do not call tools from these sources until they recover.</system-reminder>`
}
