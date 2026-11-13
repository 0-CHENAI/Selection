import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Git binary for host-owned subprocesses (isolated workspaces, merge, branch).
 * CRAFT_GIT is the bundled executable when the desktop app applied host tools.
 * execFileSync/spawnSync take the path as argv[0], so spaces in
 * `Application Support` / `Program Files` do not need extra quoting.
 */
export function gitExecutable(): string {
  const configured = process.env.CRAFT_GIT?.trim()
  if (configured && existsSync(configured)) return configured
  return process.platform === 'win32' ? 'git.exe' : 'git'
}

export function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    LC_ALL: extra?.LC_ALL ?? 'C',
    APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: extra?.APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP
      ?? process.env.APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP
      ?? '1',
    GIT_TERMINAL_PROMPT: extra?.GIT_TERMINAL_PROMPT ?? process.env.GIT_TERMINAL_PROMPT ?? '0',
  }
}

export function execGit(
  cwd: string,
  args: string[],
  extra?: { env?: NodeJS.ProcessEnv; encoding?: 'utf8'; maxBuffer?: number },
): string {
  return execFileSync(gitExecutable(), args, {
    cwd,
    env: gitEnv(extra?.env),
    encoding: extra?.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: extra?.maxBuffer,
  }).trim()
}

export function spawnGit(
  args: string[],
  extra?: { cwd?: string; env?: NodeJS.ProcessEnv; encoding?: 'buffer'; maxBuffer?: number },
): SpawnSyncReturns<Buffer> {
  return spawnSync(gitExecutable(), args, {
    cwd: extra?.cwd,
    env: gitEnv(extra?.env),
    encoding: extra?.encoding ?? 'buffer',
    maxBuffer: extra?.maxBuffer,
  })
}
