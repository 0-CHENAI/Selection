/**
 * ORDER/Laufry composes tool arguments in JSON-schema property order.
 * Nested `qualification` often absorbs later top-level keys (role, lifecycle,
 * spawnReason, Craft metadata). Recover before Pi validates, but only hoist
 * values that still match the published spawn_session field types.
 */

const QUALIFICATION_KEYS = new Set(['tracks', 'parallelBenefit', 'finalAggregation'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function canHoistSpawnField(key: string, value: unknown): boolean {
  switch (key) {
    case 'help':
      return typeof value === 'boolean'
    case 'prompt':
    case 'name':
    case 'llmConnection':
    case 'model':
    case 'workingDirectory':
    case '_intent':
    case '_displayName':
      return typeof value === 'string'
    case 'spawnReason':
      return value === 'user-requested' || value === 'automatic'
    case 'lifecycle':
      return value === 'managed' || value === 'detached'
    case 'role':
      return value === 'coordinator' || value === 'worker' || value === 'reviewer'
    case 'permissionMode':
      return value === 'safe' || value === 'ask' || value === 'allow-all'
    case 'thinkingLevel':
      return value === 'off'
        || value === 'low'
        || value === 'medium'
        || value === 'high'
        || value === 'xhigh'
        || value === 'max'
    case 'mode':
      return value === 'wait' || value === 'background'
    case 'timeoutMs':
      return typeof value === 'number' && Number.isFinite(value)
    case 'enabledSourceSlugs':
    case 'labels':
      return isStringArray(value)
    case 'attachments':
      return Array.isArray(value)
    default:
      return false
  }
}

export function isSpawnSessionToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === 'spawn_session' || normalized.endsWith('__spawn_session')
}

/**
 * Lift misplaced top-level spawn fields out of `qualification` and drop
 * unknown nested keys so the remaining object matches the published contract.
 */
export function recoverSpawnSessionArguments(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const qualification = input.qualification
  if (!isRecord(qualification)) return input

  const next: Record<string, unknown> = { ...input }
  const cleaned: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(qualification)) {
    if (QUALIFICATION_KEYS.has(key)) {
      cleaned[key] = value
      continue
    }
    changed = true
    if (next[key] === undefined && canHoistSpawnField(key, value)) {
      next[key] = value
    }
  }

  if (!changed && Object.keys(cleaned).length === Object.keys(qualification).length) {
    return input
  }

  next.qualification = cleaned
  return next
}
