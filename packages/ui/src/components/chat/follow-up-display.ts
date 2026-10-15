/**
 * Canonical follow-up section markers stored on the user message and sent to
 * the agent. `formatFollowUpSection` keeps these English tokens so the
 * round-trip parser can find them. The message bubble replaces them with the
 * localized heading at display time.
 */
export function localizeFollowUpSectionHeading(content: string, label: string): string {
  if (!content) return content
  return content.replace(/\*\*Follow-ups\*\*|Follow-up annotations:/gi, (match) =>
    match.includes('*') ? `**${label}**` : label,
  )
}
