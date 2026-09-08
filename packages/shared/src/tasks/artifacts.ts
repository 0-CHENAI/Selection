import { createHash } from 'crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'fs';
import { extname, isAbsolute, relative, resolve, sep } from 'path';

export interface ArtifactMeta {
  /** Path base. Omitted for backward-compatible workspace-relative artifacts. */
  scope?: 'workspace' | 'cwd';
  path: string;
  mime: string;
  size: number;
  hash: string;
}

export type ArtifactResolveResult = { ok: true; artifact: ArtifactMeta } | { ok: false; error: string };

function mimeFromExt(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.md':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * Resolve a declared artifact path against workspace/cwd. Symlinks are followed
 * via realpath; the real file must stay inside workspaceRoot or the explicit
 * task cwd. Relative declarations resolve from cwd when one is configured.
 */
export function resolveArtifact(
  workspaceRoot: string,
  cwd: string | undefined,
  declared: string,
): ArtifactResolveResult {
  if (!declared || typeof declared !== 'string') return { ok: false, error: 'artifact path is empty' };
  const base = cwd && cwd.trim() ? cwd : workspaceRoot;
  const abs = isAbsolute(declared) ? resolve(declared) : resolve(base, declared);
  if (!existsSync(abs)) return { ok: false, error: 'artifact not found' };
  if (lstatSync(abs).isSymbolicLink()) {
    // Follow, then reject if the real path escaped.
  }
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return { ok: false, error: 'artifact not found' };
  }
  const rootReal = realpathSync(workspaceRoot);
  let cwdReal: string | undefined;
  if (cwd && cwd.trim()) {
    try {
      cwdReal = realpathSync(cwd);
    } catch {
      // An invalid cwd cannot serve as a trusted artifact root.
    }
  }
  const inWorkspace = isInside(rootReal, real);
  const inCwd = cwdReal ? isInside(cwdReal, real) : false;
  if (!inWorkspace && !inCwd) return { ok: false, error: 'artifact escapes allowed roots' };
  const st = statSync(real);
  if (!st.isFile()) return { ok: false, error: 'artifact is not a file' };
  const buf = readFileSync(real);
  return {
    ok: true,
    artifact: {
      ...(inWorkspace ? {} : { scope: 'cwd' as const }),
      path: relative(inWorkspace ? rootReal : cwdReal!, real),
      mime: mimeFromExt(real),
      size: st.size,
      hash: createHash('sha256').update(buf).digest('hex'),
    },
  };
}
