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
