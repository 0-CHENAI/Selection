import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSanitizedEnv } from './sandbox-env.ts';

export type OfficeResidentProcessRunner = (
  binary: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; truncated: boolean }>;

export type OfficeResidentMode = 'resident' | 'standalone';

export interface OfficeResidentLease {
  file: string;
  sessions: Set<string>;
  opened: boolean;
  binary?: string;
  cwd?: string;
  runner?: OfficeResidentProcessRunner;
}

const leases = new Map<string, OfficeResidentLease>();
const leaseOps = new Map<string, Promise<unknown>>();

export function runExclusiveOfficeLease<T>(file: string, op: () => Promise<T>): Promise<T> {
  const key = officeLeaseKey(file);
  const previous = leaseOps.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(op);
  leaseOps.set(key, current.then(() => undefined, () => undefined));
  return current;
}

export function buildOfficeEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
  mode: OfficeResidentMode = 'standalone',
): NodeJS.ProcessEnv {
  return {
    ...createSanitizedEnv(baseEnv),
    OFFICECLI_SKIP_UPDATE: '1',
    OFFICECLI_NO_AUTO_INSTALL: '1',
    ...(mode === 'standalone'
      ? {
          OFFICECLI_NO_AUTO_RESIDENT: '1',
          OFFICECLI_RESIDENT_FLUSH: 'each',
        }
      : {}),
    NO_COLOR: '1',
  };
}

export function officeLeaseKey(path: string): string {
  return existsSync(path) ? realpathSync.native(path) : resolve(path);
}

export function attachOfficeResidentSession(sessionId: string, file: string): OfficeResidentLease {
  const key = officeLeaseKey(file);
  let lease = leases.get(key);
  if (!lease) {
    lease = { file: key, sessions: new Set(), opened: false };
    leases.set(key, lease);
  }
  lease.sessions.add(sessionId);
  return lease;
}

export function bindOfficeResidentRunner(
  file: string,
  binary: string,
  cwd: string,
  runner: OfficeResidentProcessRunner,
): void {
  const lease = leases.get(officeLeaseKey(file));
  if (!lease) return;
  lease.binary = binary;
  lease.cwd = cwd;
  lease.runner = runner;
}

export function markOfficeResidentOpened(file: string, opened: boolean): void {
  const lease = leases.get(officeLeaseKey(file));
  if (lease) lease.opened = opened;
}

export function hasOpenOfficeResidentLease(file: string): boolean {
  return leases.get(officeLeaseKey(file))?.opened === true;
}

export function detachOfficeResidentSession(sessionId: string): OfficeResidentLease[] {
  const closable: OfficeResidentLease[] = [];
  for (const [key, lease] of leases) {
    if (!lease.sessions.has(sessionId)) continue;
    lease.sessions.delete(sessionId);
    if (lease.sessions.size === 0) {
      leases.delete(key);
      closable.push(lease);
    }
  }
  return closable;
}

export function clearOfficeResidentLeases(): void {
  for (const lease of leases.values()) {
    lease.opened = false;
    lease.sessions.clear();
  }
  leases.clear();
  leaseOps.clear();
}

export async function closeOfficeResidentLease(lease: OfficeResidentLease): Promise<void> {
  await runExclusiveOfficeLease(lease.file, async () => {
    if (!lease.opened || !lease.runner || !lease.binary || !lease.cwd) {
      lease.opened = false;
      return;
    }
    try {
      await lease.runner(lease.binary, ['save', lease.file, '--json'], {
        cwd: lease.cwd,
        env: buildOfficeEnvironment(undefined, 'resident'),
        timeoutMs: 5_000,
      });
    } catch {
      // Close even if the last flush fails so the resident cannot stay wedged.
    }
    try {
      await lease.runner(lease.binary, ['close', lease.file, '--json'], {
        cwd: lease.cwd,
        env: buildOfficeEnvironment(undefined, 'resident'),
        timeoutMs: 5_000,
      });
    } finally {
      lease.opened = false;
    }
  });
}
