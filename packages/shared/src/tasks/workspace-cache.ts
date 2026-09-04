/**
 * Strict workspace-pure cache. Cross-run reuse is opt-in and fingerprint-complete.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync } from '../utils/files.ts';
import {
  CONDUCTOR_CACHE_RUNTIME_VERSION,
  WORKSPACE_CACHE_TTL_MS,
  type TaskNode,
  type TaskSpec,
} from './schema.ts';
import type { NodeOutput } from './refs.ts';

export interface WorkspaceCacheKeyInput {
  prompt: string;
  inputs: Record<string, unknown>;
  dependencyOutputs: Record<string, { text: string; params?: Record<string, unknown> }>;
  artifactHashes: string[];
  model?: string;
  connection: string;
  skillContents: Record<string, string>;
  runtimeVersion?: string;
  permissionMode?: string;
}

export interface WorkspaceCacheRecord {
  fingerprint: string;
  createdAt: string;
  sourceRunId: string;
  sourceNodeId: string;
  connection: string;
  output: NodeOutput;
}

export interface WorkspaceCacheLookup {
  status: 'hit' | 'miss' | 'bypass';
  record?: WorkspaceCacheRecord;
  reason?: string;
}

const CACHE_ROOT = join('tasks', '.cache', 'workspace-pure');

export function workspaceCacheDir(workspaceRoot: string, connection: string): string {
  const safe = connection.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
  return join(workspaceRoot, CACHE_ROOT, safe);
}

export function fingerprintWorkspaceCache(input: WorkspaceCacheKeyInput): string {
  const payload = {
    prompt: input.prompt,
    inputs: input.inputs,
    dependencyOutputs: input.dependencyOutputs,
    artifactHashes: [...input.artifactHashes].sort(),
    model: input.model ?? '',
    connection: input.connection,
    skillContents: input.skillContents,
    runtimeVersion: input.runtimeVersion ?? CONDUCTOR_CACHE_RUNTIME_VERSION,
    permissionMode: input.permissionMode ?? 'safe',
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function isWorkspaceCacheKindAllowed(kind: string | undefined): boolean {
  return kind !== 'verify' && kind !== 'judge' && kind !== 'approval' && kind !== 'finally';
}

export function workspaceCacheBypassReason(args: {
  node: TaskNode;
  spec: TaskSpec;
  usedTools?: boolean;
  usedSensitiveParams?: boolean;
  hasDynamicSources?: boolean;
  writesEnabled?: boolean;
}): string | undefined {
  if (args.node.cache !== 'workspace-pure') return 'cache-mode';
  if (!isWorkspaceCacheKindAllowed(args.node.kind)) return 'uncacheable-kind';
  if (args.usedSensitiveParams) return 'sensitive-params';
  if (args.writesEnabled) return 'writes-enabled';
  if (args.hasDynamicSources) return 'dynamic-sources';
  if (args.usedTools) return 'tool-calls';
  return undefined;
}

export function readWorkspaceCache(
  workspaceRoot: string,
  connection: string,
  fingerprint: string,
  nowMs: number,
): WorkspaceCacheLookup {
  const path = join(workspaceCacheDir(workspaceRoot, connection), `${fingerprint}.json`);
  if (!existsSync(path)) return { status: 'miss' };
  try {
    const record = JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceCacheRecord;
    if (record.fingerprint !== fingerprint) return { status: 'miss' };
    if (Date.parse(record.createdAt) + WORKSPACE_CACHE_TTL_MS <= nowMs) {
      try {
        unlinkSync(path);
      } catch {
        // expired entry stays unreadable
      }
      return { status: 'miss', reason: 'ttl' };
    }
    return { status: 'hit', record };
  } catch {
    return { status: 'miss' };
  }
}

export function writeWorkspaceCache(
  workspaceRoot: string,
  record: WorkspaceCacheRecord,
): void {
  const dir = workspaceCacheDir(workspaceRoot, record.connection);
  mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(join(dir, `${record.fingerprint}.json`), JSON.stringify(record));
}

export function pruneWorkspaceCache(workspaceRoot: string, nowMs: number): number {
  const root = join(workspaceRoot, CACHE_ROOT);
  if (!existsSync(root)) return 0;
  let removed = 0;
  for (const connection of readdirSync(root, { withFileTypes: true })) {
    if (!connection.isDirectory()) continue;
    const dir = join(root, connection.name);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const path = join(dir, file);
      try {
        const record = JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceCacheRecord;
        if (Date.parse(record.createdAt) + WORKSPACE_CACHE_TTL_MS <= nowMs) {
          unlinkSync(path);
          removed += 1;
        }
      } catch {
        try {
          unlinkSync(path);
          removed += 1;
        } catch {
          // ignore
        }
      }
    }
  }
  return removed;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function cacheFileDir(path: string): string {
  return dirname(path);
}
