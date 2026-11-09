/**
 * Runtime memory of thinking stops a provider actually accepted.
 *
 * The main process and the renderer do not share a heap, so each process
 * keeps this map. The renderer mirrors it to localStorage. The main process
 * registers a file saver. A learned probe is also broadcast as a session
 * event so the other process picks it up immediately.
 */
import { bareThinkingModelId } from './thinking-capabilities-id.ts'

export interface ThinkingProbeRecord {
  mode: 'unsupported' | 'always-on' | 'levels'
  levels: string[]
  binary?: boolean
  requestLevel?: string
}

const STORAGE_KEY = 'selection.thinking-probes.v1'
const probes = new Map<string, ThinkingProbeRecord>()
const listeners = new Set<() => void>()
let version = 0
let hydrating = false
let saver: (() => void) | null = null

function persist(): void {
  if (hydrating) return
  try {
    saver?.()
  } catch {
    // Disk cache is best-effort. The in-memory probe still applies.
  }
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...probes.entries()]))
  } catch {
    // Quota or a locked storage partition. The session event still updates this process.
  }
}

function loadLocal(): void {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return
    hydrating = true
    for (const entry of parsed) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object') continue
      probes.set(entry[0], entry[1] as ThinkingProbeRecord)
    }
  } catch {
    // Ignore a corrupt cache. The next rejection will learn the stop again.
  } finally {
    hydrating = false
  }
}

loadLocal()

export function thinkingProbeKeys(provider: string | undefined, modelId: string): string[] {
  const bare = bareThinkingModelId(modelId)
  if (!bare) return []
  const keys = [`:${bare}`]
  const auth = provider?.trim().toLowerCase()
  if (auth && auth !== 'pi') keys.unshift(`${auth}:${bare}`)
  return keys
}

export function rememberThinkingProbe(keys: readonly string[], record: ThinkingProbeRecord): void {
  if (keys.length === 0) return
  for (const key of keys) probes.set(key, record)
  version += 1
  for (const listener of listeners) listener()
  persist()
}

export function lookupThinkingProbe(provider: string | undefined, modelId: string): ThinkingProbeRecord | undefined {
  const keys = thinkingProbeKeys(provider, modelId)
  for (const key of keys) {
    const hit = probes.get(key)
    if (hit) return hit
  }
  return undefined
}

export function subscribeThinkingProbes(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function thinkingProbeVersion(): number {
  return version
}

export function exportThinkingProbes(): Array<[string, ThinkingProbeRecord]> {
  return [...probes.entries()]
}

export function importThinkingProbes(entries: Array<[string, ThinkingProbeRecord]>): void {
  hydrating = true
  try {
    probes.clear()
    for (const [key, record] of entries) {
      if (typeof key === 'string' && record && typeof record === 'object') probes.set(key, record)
    }
    version += 1
    for (const listener of listeners) listener()
  } finally {
    hydrating = false
  }
}

export function setThinkingProbeSaver(next: (() => void) | null): void {
  saver = next
}

export function resetThinkingProbes(): void {
  probes.clear()
  version += 1
  for (const listener of listeners) listener()
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Tests that have no storage still clear the map.
  }
}
