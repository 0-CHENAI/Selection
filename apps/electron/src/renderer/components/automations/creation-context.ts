/** Stable category keys also identify detached drafts in the creation task center. */
export const AUTOMATION_CREATION_KEYS = [
  'add-automation',
  'add-automation-scheduled',
  'add-automation-event',
  'add-automation-agentic',
] as const

export type AutomationCreationKey = typeof AUTOMATION_CREATION_KEYS[number]
export type AutomationCreationCategory = 'scheduled' | 'event' | 'agentic'

export function automationCreationKey(
  category?: AutomationCreationCategory | 'app' | 'agent' | 'all',
): AutomationCreationKey {
  switch (category) {
    case 'scheduled': return 'add-automation-scheduled'
    case 'app':
    case 'event': return 'add-automation-event'
    case 'agent':
    case 'agentic': return 'add-automation-agentic'
    default: return 'add-automation'
  }
}
