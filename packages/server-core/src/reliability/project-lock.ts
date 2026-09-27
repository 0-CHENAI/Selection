import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export class ProjectLockBusyError extends Error {
  constructor() { super('Project integration is already active'); this.name = 'ProjectLockBusyError' }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw new Error('Project lock ownership cannot be verified')
  }
}

/**
 * Publish a unique contender before scanning. Two simultaneous contenders may
 * both back off, but cannot both enter: each sees the other's live directory.
 * Dead owners are ignored, never deleted or renamed, so reclamation cannot
 * accidentally steal a newly acquired lock. No time-based expiry of live work.
 */
export function acquireProjectLock(directory: string): () => void {
  mkdirSync(directory, { recursive: true })
  const name = `writer-${process.pid}-${randomUUID()}`
  const own = join(directory, name)
  mkdirSync(own)
  try {
    for (const entry of readdirSync(directory)) {
      if (entry === name) continue
      if (entry === 'writer') throw new Error('Legacy project lock requires inspection')
      if (!entry.startsWith('writer-')) continue
      const match = /^writer-([1-9][0-9]*)-[a-f0-9-]{36}$/.exec(entry)
      if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Invalid project lock owner')
      if (alive(Number(match[1]))) throw new ProjectLockBusyError()
    }
  } catch (error) { rmSync(own, { recursive: true, force: true }); throw error }
  let released = false
  return () => { if (!released) { rmSync(own, { recursive: true, force: true }); released = true } }
}
