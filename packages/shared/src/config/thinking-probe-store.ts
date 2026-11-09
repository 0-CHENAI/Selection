/**
 * Persist learned thinking probes for the main process. The renderer keeps
 * its own copy in localStorage; a session event copies a new probe across.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from './paths.ts'
import {
  exportThinkingProbes,
  importThinkingProbes,
  setThinkingProbeSaver,
  type ThinkingProbeRecord,
} from '../agent/thinking-probe.ts'

function probeFile(): string {
  return join(CONFIG_DIR, 'cache', 'thinking-probes.json')
}

function saveThinkingProbeStore(): void {
  const path = probeFile()
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(exportThinkingProbes()))
}

export function loadThinkingProbeStore(): void {
  setThinkingProbeSaver(saveThinkingProbeStore)
  try {
    const parsed = JSON.parse(readFileSync(probeFile(), 'utf8')) as Array<[string, ThinkingProbeRecord]>
    if (Array.isArray(parsed)) importThinkingProbes(parsed)
  } catch {
    // First launch has no probe file.
  }
}
