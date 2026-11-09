/**
 * Whether a session that just completed should raise the in-app "background finished" chip.
 *
 * The chip preference covers any session that is not on screen. Nested sub-sessions of a session
 * the user *is* looking at always announce, even when that preference is off: the child is not
 * visible in a panel, and the parent/project list does not otherwise tell you it finished.
 */
export function shouldAnnounceBackgroundFinish(args: {
  sessionId: string
  hidden?: boolean
  chipPreference: boolean
  visibleSessionIds: ReadonlySet<string>
  ancestorIds: readonly string[]
}): boolean {
  if (args.hidden) return false
  if (args.visibleSessionIds.has(args.sessionId)) return false
  if (args.chipPreference) return true
  return args.ancestorIds.some(id => args.visibleSessionIds.has(id))
}
