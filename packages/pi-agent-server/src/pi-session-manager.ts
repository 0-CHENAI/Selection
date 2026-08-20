import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SessionManager as PiSessionManager } from '@earendil-works/pi-coding-agent'

export interface CreatePiSessionManagerOptions {
  cwd: string
  sessionDir: string
  resumeSdkSessionId?: string
  branchFromSessionPath?: string
  branchFromSdkSessionId?: string
  branchFromSdkTurnId?: string
  forceFreshSession?: boolean
}

function findMostRecentSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null
  let best: { path: string; mtime: number } | null = null
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue
    const fullPath = join(sessionDir, entry)
    const mtime = statSync(fullPath).mtimeMs
    if (!best || mtime > best.mtime) {
      best = { path: fullPath, mtime }
    }
  }
  return best?.path ?? null
}

function findSessionFileById(sessionDir: string, sdkSessionId?: string): string | null {
  if (!sdkSessionId || !existsSync(sessionDir)) return null
  const suffix = `_${sdkSessionId}.jsonl`
  const entry = readdirSync(sessionDir).find(name => name.endsWith(suffix))
  return entry ? join(sessionDir, entry) : null
}

/** Select the exact Pi history used by a normal send, branch, or regenerate. */
export function createPiSessionManager(options: CreatePiSessionManagerOptions): PiSessionManager {
  const {
    cwd,
    sessionDir,
    resumeSdkSessionId,
    branchFromSessionPath,
    branchFromSdkSessionId,
    branchFromSdkTurnId,
    forceFreshSession,
  } = options

  if (branchFromSessionPath) {
    const parentSessionDir = join(branchFromSessionPath, '.pi-sessions')
    const parentSessionFile = findSessionFileById(parentSessionDir, branchFromSdkSessionId)
      ?? findMostRecentSessionFile(parentSessionDir)
    if (!parentSessionFile) {
      throw new Error(`Pi branch preflight failed: no parent Pi session file found in ${parentSessionDir}`)
    }

    const forked = PiSessionManager.forkFrom(parentSessionFile, cwd, sessionDir)
    if (branchFromSdkTurnId) {
      if (!forked.getEntry(branchFromSdkTurnId)) {
        throw new Error(`Pi branch preflight failed: branch anchor not found: ${branchFromSdkTurnId}`)
      }
      forked.branch(branchFromSdkTurnId)
    }
    return forked
  }

  if (forceFreshSession) {
    return PiSessionManager.create(cwd, sessionDir)
  }

  const requestedSessionFile = findSessionFileById(sessionDir, resumeSdkSessionId)
  return requestedSessionFile
    ? PiSessionManager.open(requestedSessionFile, sessionDir, cwd)
    : PiSessionManager.continueRecent(cwd, sessionDir)
}
