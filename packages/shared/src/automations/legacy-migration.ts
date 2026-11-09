/**
 * Matcher fields accepted only while reading older automation resources.
 * Validation ignores these keys so retired integrations do not prevent an
 * otherwise valid resource bundle from loading.
 */
export const LEGACY_AUTOMATION_MATCHER_FIELDS = ['telegramTopic'] as const

/** Retired runtime automation events. Kept only to read pre-removal configs. */
export const RETIRED_AUTOMATION_EVENTS: readonly string[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit',
  'SessionStart', 'SessionEnd', 'Stop', 'SubagentStart', 'SubagentStop',
  'PreCompact', 'PermissionRequest', 'Setup',
]

/** Ignore retired rules before validating their payloads, even if malformed. */
export function omitRetiredAutomations(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const config = content as Record<string, unknown>
  const events = config.automations
  if (!events || typeof events !== 'object' || Array.isArray(events)) return content
  return {
    ...config,
    automations: Object.fromEntries(Object.entries(events).filter(([event]) => !RETIRED_AUTOMATION_EVENTS.includes(event))),
  }
}
