import { join } from 'node:path'

/** Resolve Pi SDK state strictly underneath one Craft Session directory. */
export function resolvePiSessionPaths(sessionPath: string, configuredAgentDir?: string): {
  agentDir: string
  sessionDir: string
} {
  return {
    agentDir: configuredAgentDir || join(sessionPath, '.pi-agent'),
    sessionDir: join(sessionPath, '.pi-sessions'),
  }
}
