/**
 * Smart confirmation rules for the `ask` permission mode ("Smart Approval" / 智能审批).
 *
 * Principle: reversible work that only touches the session's own folders runs
 * without a prompt; anything irreversible, outside those folders, sensitive, or
 * that cannot be classified asks first. Rules are deterministic — no model is
 * consulted — and every helper fails closed (returns "ask") when unsure.
 */

import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { expandPath } from '../../utils/paths.ts';
import { extractSimpleCommandsStrict } from '../bash-validator.ts';
import type { CompiledBashPattern } from '../mode-types.ts';

// ============================================================
// Paths
// ============================================================

/**
 * Resolve symlinks for a path that may not exist yet: realpath the deepest
 * existing ancestor, then re-append the missing tail. Prevents a symlink inside
 * the working directory from smuggling a write to somewhere else.
 */
export function realPathForWrite(absPath: string): string {
  let current = resolve(absPath);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(absPath);
    tail.unshift(basename(current));
    current = parent;
  }
  try {
    return tail.length ? join(realpathSync(current), ...tail) : realpathSync(current);
  } catch {
    return resolve(absPath);
  }
}

export function isWithinDirectory(target: string, directory: string): boolean {
  const rel = relative(directory, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * A working directory is only trusted for automatic writes when it is a real
 * project folder. The filesystem root, the home directory, or any ancestor of
 * home would make "inside the working directory" mean "almost anywhere".
 */
export function isTrustedWorkingDirectory(directory: string | undefined, home = homedir()): boolean {
  if (!directory) return false;
  const real = realPathForWrite(expandPath(directory));
  if (real === parse(real).root) return false;
  const realHome = realPathForWrite(home);
  return !isWithinDirectory(realHome, real);
}

export interface TrustedZones {
  /** Session working directory, if set and trusted. */
  workingDirectory?: string;
  /** Session-owned folder (plans, data, downloads). Always trusted. */
  sessionFolder?: string;
}

export function resolveTrustedZones(
  workingDirectory: string | undefined,
  sessionFolder: string | undefined,
  home = homedir(),
): TrustedZones {
  return {
    workingDirectory: isTrustedWorkingDirectory(workingDirectory, home)
      ? realPathForWrite(expandPath(workingDirectory!))
      : undefined,
    sessionFolder: sessionFolder ? realPathForWrite(sessionFolder) : undefined,
  };
}

const SENSITIVE_DIR_SEGMENTS = new Set(['.git', '.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gh']);
const SENSITIVE_FILE_NAMES = new Set([
  '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials', '.htpasswd',
]);
const SENSITIVE_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
];
/** Committed env templates are not secrets. */
const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist)$/i;

/** Secrets, credentials, and VCS internals always need explicit approval. */
export function isSensitivePath(absPath: string): boolean {
  const name = basename(absPath);
  if (ENV_TEMPLATE.test(name)) return false;
  if (SENSITIVE_FILE_NAMES.has(name)) return true;
  if (SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(name))) return true;
  const normalized = absPath.split(sep).join('/');
  for (const segment of SENSITIVE_DIR_SEGMENTS) {
    if (normalized.includes(`/${segment}/`)) return true;
  }
  return false;
}

// ============================================================
// File writes
// ============================================================

export type FileWriteDecision =
  | { autoAllow: true }
  | { autoAllow: false; reason: 'sensitive' | 'outside_zone' | 'unknown_path'; rememberKey?: string; resolvedPath?: string };

/** Approval keys. Prefixed so they never collide with tool or command names. */
export const rememberKeys = {
  writeDir: (dir: string) => `write-dir:${dir}`,
  writeFile: (file: string) => `write-file:${file}`,
  bash: (command: string) => `bash:${command.trim()}`,
  tool: (toolName: string) => `tool:${toolName}`,
  api: (description: string) => `api:${description}`,
};

export function classifyFileWrite(
  rawPath: string | undefined,
  zones: TrustedZones,
  baseDirectory: string | undefined,
  isRemembered: (key: string) => boolean,
): FileWriteDecision {
  const trimmed = rawPath?.trim();
  if (!trimmed) return { autoAllow: false, reason: 'unknown_path' };
  // expandPath resolves relative paths against process.cwd(), which is not the
  // agent's directory — relative paths need an explicit base or must ask.
  const isRelative = !isAbsolute(trimmed) && !/^~([\\/]|$)/.test(trimmed) && !/^\$(\{HOME\}|HOME)/.test(trimmed);
  if (isRelative && !baseDirectory) return { autoAllow: false, reason: 'unknown_path' };
  const absolute = realPathForWrite(expandPath(trimmed, baseDirectory));

  if (isSensitivePath(absolute)) {
    const key = rememberKeys.writeFile(absolute);
    return isRemembered(key) ? { autoAllow: true } : { autoAllow: false, reason: 'sensitive', rememberKey: key, resolvedPath: absolute };
  }

  const inZone = [zones.workingDirectory, zones.sessionFolder]
    .some(zone => !!zone && isWithinDirectory(absolute, zone));
  if (inZone) return { autoAllow: true };

  // Approval for a directory covers files beneath it.
  for (let dir = dirname(absolute); ; dir = dirname(dir)) {
    if (isRemembered(rememberKeys.writeDir(dir))) return { autoAllow: true };
    if (dirname(dir) === dir) break;
  }
  return { autoAllow: false, reason: 'outside_zone', rememberKey: rememberKeys.writeDir(dirname(absolute)), resolvedPath: absolute };
}

// ============================================================
// Bash
// ============================================================

/**
 * Routine, reversible development commands. Matched against the words of one
 * simple command joined by single spaces. Deliberately excludes anything that
 * installs, publishes, deletes, rewrites history, or fetches and runs code
 * (npx/bunx, npm install, git push/reset, make with arbitrary targets...).
 */
const SCRIPT_NAMES = '(test|build|lint|format|fmt|typecheck|type-check|check|compile)';
export const SMART_CONFIRM_DEV_PATTERNS: readonly RegExp[] = [
  /^git (add|commit|fetch|init)( |$)/,
  /^git switch -c [^ ]+$/,
  /^git stash( (push|save|list|show)( |$)|$)/,
  /^(npm|pnpm|yarn|bun) test( |$)/,
  new RegExp(`^(npm|pnpm|yarn|bun) (run|run-script) ${SCRIPT_NAMES}(:[\\w.-]+)*( |$)`),
  new RegExp(`^(pnpm|yarn) ${SCRIPT_NAMES}(:[\\w.-]+)*( |$)`),
  /^(tsc|eslint|prettier|vitest|jest|pytest|ruff|black|mypy|biome)( |$)/,
  /^python3? -m (pytest|unittest|mypy|ruff|black)( |$)/,
  /^cargo (build|test|check|clippy|fmt)( |$)/,
  /^go (build|test|vet|fmt)( |$)/,
  /^make (test|build|lint|check|fmt|format)$/,
  /^(mkdir|touch)( |$)/,
];

/** Commands whose path arguments decide where later commands act. */
const DIRECTORY_CHANGING = new Set(['cd', 'pushd']);

/** True when an argument could point outside the current directory tree. */
function escapesWorkingTree(arg: string): boolean {
  const value = arg.includes('=') && arg.startsWith('-') ? arg.slice(arg.indexOf('=') + 1) : arg;
  if (value.startsWith('/') || value.startsWith('~') || value.startsWith('\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return value.split(/[\\/]/).includes('..');
}

/**
 * Decide whether a Bash command can run without a prompt.
 *
 * Every simple command must be either read-only (the user's explore-mode
 * allowlist) or a routine dev command, and dev commands plus `cd`/`pushd` may
 * not reference paths outside the working tree. Requires a trusted working
 * directory, because relative paths are only meaningful inside it.
 */
export function isAutoApprovableBashCommand(
  command: string,
  readOnlyPatterns: readonly CompiledBashPattern[],
  zones: TrustedZones,
): boolean {
  if (!zones.workingDirectory) return false;
  const commands = extractSimpleCommandsStrict(command);
  if (!commands || commands.length === 0) return false;

  for (const words of commands) {
    const joined = words.join(' ');
    const name = words[0]!;
    const isDev = SMART_CONFIRM_DEV_PATTERNS.some(pattern => pattern.test(joined));
    const isReadOnly = !isDev && readOnlyPatterns.some(pattern => pattern.regex.test(joined));
    if (!isDev && !isReadOnly) return false;
    if (isDev || DIRECTORY_CHANGING.has(name)) {
      if (DIRECTORY_CHANGING.has(name) && words.length < 2) return false; // bare `cd` goes to $HOME
      if (words.slice(1).some(escapesWorkingTree)) return false;
    }
  }
  return true;
}
