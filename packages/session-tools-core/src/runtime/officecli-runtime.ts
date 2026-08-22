import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { join } from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const fileLocks = new Map<string, Promise<void>>();

function fileLockKeys(file: string): string[] {
  let canonical = file;
  let inodeKey: string | undefined;
  try {
    canonical = realpathSync.native(file);
    const stat = statSync(canonical);
    // dev+ino also unifies hard-link aliases that realpath alone cannot.
    if (stat.ino !== 0) inodeKey = `inode:${stat.dev}:${stat.ino}`;
  } catch {
    // Missing paths retain their normalized lexical key.
  }
  const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  // Keep the canonical path key as well as the inode. Atomic package rewrites
  // replace the inode while a task is still running; the stable path key keeps
  // a concurrent call from slipping past during that replacement window.
  return [`path:${normalized}`, ...(inodeKey ? [inodeKey] : [])];
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill('SIGKILL');
    return;
  }
  if (process.platform !== 'win32') {
    // A new POSIX session/process group changes OfficeCLI's resident lifecycle
    // and can make a successful batch disappear before the next command. Keep
    // normal spawn semantics, stop the root, snapshot its descendant tree, and
    // terminate leaves before the root instead.
    try {
      process.kill(child.pid, 'SIGSTOP');
    } catch { /* process may already have exited */ }
    const psPath = ['/bin/ps', '/usr/bin/ps'].find(existsSync);
    if (psPath) {
      const listing = spawnSync(psPath, ['-axo', 'pid=,ppid='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const children = new Map<number, number[]>();
      for (const line of listing.stdout?.split(/\r?\n/) ?? []) {
        const match = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (!match) continue;
        const pid = Number(match[1]);
        const parent = Number(match[2]);
        children.set(parent, [...(children.get(parent) ?? []), pid]);
      }
      const descendants: number[] = [];
      const visit = (pid: number) => {
        for (const descendant of children.get(pid) ?? []) {
          visit(descendant);
          descendants.push(descendant);
        }
      };
      visit(child.pid);
      for (const pid of descendants) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
      }
    }
    child.kill('SIGKILL');
    return;
  }

  // Node has no native Windows Job Object API. taskkill /T is the OS-provided
  // tree-aware fallback; use an absolute system path and never a shell/PATH.
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (systemRoot) {
    const result = spawnSync(join(systemRoot, 'System32', 'taskkill.exe'), [
      '/PID', String(child.pid), '/T', '/F',
    ], { windowsHide: true, stdio: 'ignore', shell: false });
    if (!result.error && result.status === 0) return;
  }
  child.kill('SIGKILL');
}

export interface OfficecliProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputTruncated: boolean;
  /** True when the complete JSON request could not be flushed to OfficeCLI stdin. */
  stdinDeliveryFailed: boolean;
}

/** Execute the app-managed binary directly. No shell is involved. */
export async function runOfficecli(
  binaryPath: string,
  args: string[],
  options: { cwd: string; stdin?: string; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<OfficecliProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let stdinDeliveryFailed = false;
    let stdinSettled = options.stdin === undefined;
    let processClosed = false;
    let closedExitCode: number | null = null;
    let finished = false;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const captured = target === 'stdout' ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - captured);
      const accepted = chunk.subarray(0, remaining);
      if (target === 'stdout') {
        stdoutBytes += accepted.byteLength;
        stdout += stdoutDecoder.write(accepted);
      } else {
        stderrBytes += accepted.byteLength;
        stderr += stderrDecoder.write(accepted);
      }
      if (accepted.byteLength < chunk.byteLength) outputTruncated = true;
    };

    child.stdout!.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr!.on('data', (chunk: Buffer) => append('stderr', chunk));

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    const finishIfReady = () => {
      if (finished || !processClosed || !stdinSettled) return;
      finished = true;
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      resolve({
        stdout,
        stderr,
        exitCode: closedExitCode,
        timedOut,
        outputTruncated,
        stdinDeliveryFailed,
      });
    };

    child.on('error', (error) => {
      clearTimeout(timer);
      finished = true;
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      processClosed = true;
      closedExitCode = exitCode;
      // A process that closes before the stream callback/error fires did not
      // give us positive evidence that the complete request reached stdin.
      if (!stdinSettled) {
        stdinDeliveryFailed = true;
        stdinSettled = true;
        stderr += '\nOfficeCLI stdin closed before request delivery was confirmed.';
      }
      finishIfReady();
    });

    if (options.stdin !== undefined) {
      child.stdin!.on('error', (error: NodeJS.ErrnoException) => {
        stdinDeliveryFailed = true;
        stdinSettled = true;
        stderr += `\nOfficeCLI stdin error${error.code ? ` (${error.code})` : ''}: ${error.message}`;
        finishIfReady();
      });
      child.stdin!.end(options.stdin, 'utf8', () => {
        stdinSettled = true;
        finishIfReady();
      });
    }
  });
}

/** Serialize OfficeCLI reads/writes for one normalized file inside this backend process. */
export async function withOfficecliFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const keys = fileLockKeys(file);
  const previous = Promise.all([...new Set(keys.map(key => fileLocks.get(key)).filter((value): value is Promise<void> => !!value))]);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => gate);
  for (const key of keys) fileLocks.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    for (const key of keys) {
      if (fileLocks.get(key) === queued) fileLocks.delete(key);
    }
  }
}

export function parseOfficecliJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    // Some releases print a one-line notice before their JSON envelope. Find
    // the first object start, but never eval or otherwise interpret the text.
    const objectStart = trimmed.indexOf('{');
    if (objectStart < 0) return null;
    try {
      const value = JSON.parse(trimmed.slice(objectStart)) as unknown;
      return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}
