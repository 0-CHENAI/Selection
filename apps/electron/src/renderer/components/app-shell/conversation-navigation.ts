/** Config popovers hide the rail so it cannot leave a 2rem click/placeholder column. */
export function shouldShowConversationNavigation(
  enabled: boolean,
  itemCount: number,
): boolean {
  return enabled && itemCount > 0
}
