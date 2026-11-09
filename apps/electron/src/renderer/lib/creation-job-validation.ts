import type { CreationJob, CreationKind } from '@/atoms/creation-jobs'

export const CREATION_COMPLETED_EVENT = 'selection:creation-completed'

export interface CreationCompletedEventDetail {
  workspaceId: string
  kind: CreationKind
  id: string
  waitUntil: (promise: Promise<unknown>) => void
}

/** Notify list owners and wait until every mounted consumer has refreshed. */
export async function refreshCreationConsumers(
  detail: Omit<CreationCompletedEventDetail, 'waitUntil'>,
): Promise<void> {
  const pending: Promise<unknown>[] = []
  window.dispatchEvent(new CustomEvent<CreationCompletedEventDetail>(CREATION_COMPLETED_EVENT, {
    detail: { ...detail, waitUntil: (promise) => pending.push(promise) },
  }))
  await Promise.all(pending)
}

export interface NewIdDiff {
  id?: string
  error?: string
  reason?: 'none' | 'multiple'
}

export interface ExplicitAutomationIdAnalysis {
  ids: string[]
  duplicateIds: string[]
}

export function diffSingleNewId(baseline: readonly string[], current: readonly string[]): NewIdDiff {
  const before = new Set(baseline)
  const added = [...new Set(current)].filter((id) => !before.has(id)).sort()
  if (added.length === 1) return { id: added[0] }
  if (added.length === 0) return { reason: 'none', error: 'The agent finished, but no new explicit resource ID was found.' }
  return { reason: 'multiple', error: `The agent created multiple resources (${added.join(', ')}); expected exactly one.` }
}

/** Automations must carry a persisted explicit id; event/index fallbacks are not durable IDs. */
export function analyzeExplicitAutomationIds(value: unknown): ExplicitAutomationIdAnalysis {
  if (!value || typeof value !== 'object') {
    return { ids: [], duplicateIds: [] }
  }
  const automations = (value as { automations?: unknown }).automations
  if (!automations || typeof automations !== 'object') {
    return { ids: [], duplicateIds: [] }
  }

  const ids: string[] = []
  for (const matchers of Object.values(automations as Record<string, unknown>)) {
    if (!Array.isArray(matchers)) continue
    for (const matcher of matchers) {
      if (!matcher || typeof matcher !== 'object') continue
      const id = (matcher as { id?: unknown }).id
      if (typeof id === 'string' && id.trim()) ids.push(id.trim())
    }
  }
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return {
    ids: [...counts.keys()].sort(),
    duplicateIds: [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort(),
  }
}

export function extractExplicitAutomationIds(value: unknown): string[] {
  return analyzeExplicitAutomationIds(value).ids
}

export async function readCreationIds(
  kind: CreationKind,
  workspaceId: string,
  requireValid = false,
): Promise<string[]> {
  switch (kind) {
    case 'source': {
      const sources = await window.electronAPI.getSources(workspaceId)
      return [...new Set(sources.map((source) => source.config.slug).filter(Boolean))].sort()
    }
    case 'skill': {
      const skills = await window.electronAPI.getSkills(workspaceId)
      return [...new Set(skills.map((skill) => skill.slug).filter(Boolean))].sort()
    }
    case 'automation': {
      const persisted = await window.electronAPI.getAutomations(workspaceId)
      const analysis = analyzeExplicitAutomationIds(persisted)
      if (requireValid) {
        const validation = await window.electronAPI.validateAutomations(workspaceId)
        if (!validation.valid) {
          throw new Error(`Automation validation failed: ${validation.errors.join('; ')}`)
        }
        if (analysis.duplicateIds.length > 0) {
          throw new Error(`Duplicate automation IDs found: ${analysis.duplicateIds.join(', ')}`)
        }
        return [...new Set(validation.registeredIds)].sort()
      }
      if (analysis.duplicateIds.length > 0) {
        throw new Error(`Duplicate automation IDs found: ${analysis.duplicateIds.join(', ')}`)
      }
      return analysis.ids
    }
  }
}

export async function validateCreationJob(job: CreationJob): Promise<NewIdDiff> {
  const current = await readCreationIds(job.kind, job.workspaceId, true)
  const result = diffSingleNewId(job.baseline, current)
  if (job.kind === 'automation' && result.id && !/^[a-f0-9]{6}$/.test(result.id)) {
    return { error: `Automation ID "${result.id}" must be six lowercase hexadecimal characters.` }
  }
  return result
}
