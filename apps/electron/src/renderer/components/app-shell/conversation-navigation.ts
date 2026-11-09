/**
 * Config popovers hide the rail so it cannot leave a 2rem click/placeholder column.
 * A single record is one short tick at the chat's left edge, which reads as a
 * stray dash. Ticks start at the second record.
 */
export function shouldShowConversationNavigation(
  enabled: boolean,
  itemCount: number,
): boolean {
  return enabled && itemCount >= 2
}

/**
 * Reserve the 2rem left column whenever record navigation is enabled.
 * Ticks only appear after the first record; reserving earlier keeps the
 * composer from jumping. Config popovers pass enabled=false (#394).
 */
export function shouldReserveConversationNavigationColumn(enabled: boolean): boolean {
  return enabled
}

/**
 * Streaming writes text inside an existing turn. Those mutations must not
 * schedule a geometry pass over the record rail; mounting or removing a turn does.
 */
export function navigationMutationNeedsMeasure(
  records: ReadonlyArray<{ target: unknown }>,
): boolean {
  return records.some(record => !isTurnContentMutationTarget(record.target))
}

export function isTurnContentMutationTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object' || !('closest' in target)) return false
  const closest = (target as { closest?: unknown }).closest
  return typeof closest === 'function' && !!closest.call(target, '[data-chat-turn-key]')
}
