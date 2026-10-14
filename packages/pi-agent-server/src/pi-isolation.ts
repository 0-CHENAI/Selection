import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager as PiSettingsManager } from '@earendil-works/pi-coding-agent'
import { resolvePiSessionPaths } from './session-paths.ts'

/**
 * In-memory Pi settings that do not trust the workspace `.pi` directory.
 * Project extensions, skills, and settings stay out of Craft sessions.
 */
export function createIsolatedPiSettings(
  settings?: Parameters<typeof PiSettingsManager.inMemory>[0],
): PiSettingsManager {
  return PiSettingsManager.inMemory(settings, { projectTrusted: false })
}

/**
 * Directory Pi treats as `~/.pi/agent`. An empty directory means user-level
 * extensions are not loaded. Session paths use `<session>/.pi-agent`.
 */
export function resolveIsolatedAgentDir(options: {
  sessionPath?: string
  agentDir?: string
}): string {
  if (options.sessionPath) {
    const { agentDir } = resolvePiSessionPaths(options.sessionPath, options.agentDir)
    mkdirSync(agentDir, { recursive: true })
    return agentDir
  }
  if (options.agentDir) {
    mkdirSync(options.agentDir, { recursive: true })
    return options.agentDir
  }
  return mkdtempSync(join(tmpdir(), 'craft-pi-agent-'))
}
