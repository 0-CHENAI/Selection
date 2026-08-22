import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const fileLocks = new Map<string, Promise<void>>();

export interface OfficecliProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputTruncated: boolean;
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
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      resolve({ stdout, stderr, exitCode, timedOut, outputTruncated });
    });

    if (options.stdin !== undefined) {
      child.stdin!.on('error', (error: NodeJS.ErrnoException) => {
        // A fast process exit can close stdin before end() flushes. Capture the
        // condition in stderr and let close/exitCode remain authoritative.
        if (error.code !== 'EPIPE') stderr += `\nOfficeCLI stdin error: ${error.message}`;
      });
      child.stdin!.end(options.stdin, 'utf8');
    }
  });
}

/** Serialize OfficeCLI reads/writes for one normalized file inside this backend process. */
export async function withOfficecliFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(file) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => gate);
  fileLocks.set(file, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (fileLocks.get(file) === queued) fileLocks.delete(file);
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
