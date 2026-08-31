/**
 * Per-run spec revisions. conduct freezes revision 0 at start and never
 * patches it. orchestrate (P4) appends later revisions.
 */
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { runDir, writeRunSpecSnapshot, readRunSpecSnapshot } from './storage.ts';
import type { TaskSpec } from './schema.ts';

const REVISIONS_DIR = 'spec-revisions';

export function specRevisionPath(workspaceRoot: string, slug: string, runId: string, revision: number): string {
  return join(runDir(workspaceRoot, slug, runId), REVISIONS_DIR, `${String(revision).padStart(4, '0')}.json`);
}

export function writeSpecRevision(
  workspaceRoot: string,
  slug: string,
  runId: string,
  revision: number,
  spec: TaskSpec,
): void {
  const dest = specRevisionPath(workspaceRoot, slug, runId, revision);
  mkdirSync(join(dest, '..'), { recursive: true });
  atomicWriteFileSync(dest, JSON.stringify({ revision, spec }, null, 2));
  if (revision === 0) writeRunSpecSnapshot(workspaceRoot, slug, runId, spec);
}

export function readLatestSpecRevision(
  workspaceRoot: string,
  slug: string,
  runId: string,
): { revision: number; spec: TaskSpec } | null {
  let latest: { revision: number; spec: TaskSpec } | null = null;
  for (let i = 0; i < 8; i++) {
    const path = specRevisionPath(workspaceRoot, slug, runId, i);
    if (!existsSync(path)) continue;
    const spec = readSpecRevision(workspaceRoot, slug, runId, i);
    if (spec) latest = { revision: i, spec };
  }
  if (latest) return latest;
  const snap = readRunSpecSnapshot(workspaceRoot, slug, runId);
  return snap ? { revision: 0, spec: snap } : null;
}

export function readSpecRevision(
  workspaceRoot: string,
  slug: string,
  runId: string,
  revision = 0,
): TaskSpec | null {
  const path = specRevisionPath(workspaceRoot, slug, runId, revision);
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as { spec?: TaskSpec };
      return raw.spec ?? null;
    } catch {
      return null;
    }
  }
  return readRunSpecSnapshot(workspaceRoot, slug, runId);
}
