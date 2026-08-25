import { createHash } from 'crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'fs';
import { extname, isAbsolute, relative, resolve, sep } from 'path';

export interface ArtifactMeta {
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
 * via realpath; the real file must stay inside workspaceRoot or cwd.
 */
export function resolveArtifact(
  workspaceRoot: string,
  cwd: string | undefined,
  declared: string,
): ArtifactResolveResult {
  if (!declared || typeof declared !== 'string') return { ok: false, error: 'artifact path is empty' };
  const base = cwd && cwd.trim() ? cwd : workspaceRoot;
  const abs = isAbsolute(declared) ? declared : resolve(base, declared);
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
  let cwdReal = rootReal;
  if (cwd && existsSync(cwd)) {
    try {
      cwdReal = realpathSync(cwd);
    } catch {
      cwdReal = rootReal;
    }
  }
  if (!isInside(rootReal, real) && !isInside(cwdReal, real)) {
    return { ok: false, error: 'artifact escapes workspace/cwd' };
  }
  const st = statSync(real);
  if (!st.isFile()) return { ok: false, error: 'artifact is not a file' };
  const buf = readFileSync(real);
  return {
    ok: true,
    artifact: {
      path: relative(rootReal, real) || real,
      mime: mimeFromExt(real),
      size: st.size,
      hash: createHash('sha256').update(buf).digest('hex'),
    },
  };
}
