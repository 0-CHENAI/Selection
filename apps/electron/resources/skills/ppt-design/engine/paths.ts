import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Resolve through macOS tmpdir /var → /private/var before containment checks. */
export function resolvedDirectory(path: string): string {
  if (!isAbsolute(path)) throw new Error(`path must be absolute: ${path}`);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`directory does not exist: ${path}`);
  }
  return realpathSync(path);
}

export function validateOutputPath(folder: string, out: string, extension: string): string {
  if (!isAbsolute(out) || extname(out).toLowerCase() !== extension) {
    throw new Error(`--out must be an absolute ${extension} path`);
  }
  const root = resolvedDirectory(folder);
  const parent = existsSync(dirname(out)) ? realpathSync(dirname(out)) : resolve(dirname(out));
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(`output directory does not exist: ${dirname(out)}`);
  }
  const resolvedParent = realpathSync(parent);
  const distance = relative(root, resolvedParent);
  if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
    throw new Error('--out must stay inside the declared folder after symlink resolution');
  }
  if (existsSync(out)) throw new Error('Refusing to overwrite existing output');
  return resolve(resolvedParent, basename(out));
}
