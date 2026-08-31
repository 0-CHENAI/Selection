import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveArtifact } from './artifacts.ts';

describe('resolveArtifact', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'artifact-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records relative path, mime, size, and hash for a workspace file', () => {
    writeFileSync(join(root, 'note.md'), 'hello');
    const res = resolveArtifact(root, undefined, 'note.md');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.artifact.path).toBe('note.md');
    expect(res.artifact.mime).toBe('text/markdown');
    expect(res.artifact.size).toBe(5);
    expect(res.artifact.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a symlink that escapes the workspace', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'nope');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    const res = resolveArtifact(root, undefined, 'link.txt');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/escapes/);
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects missing files', () => {
    expect(resolveArtifact(root, undefined, 'missing.bin').ok).toBe(false);
  });

  it('rejects absolute paths even when they point inside the workspace', () => {
    const absolute = join(root, 'note.md');
    writeFileSync(absolute, 'hello');
    const res = resolveArtifact(root, undefined, absolute);
    expect(res).toEqual({ ok: false, error: 'artifact path must be workspace-relative' });
  });

  it('does not treat an external task cwd as a trusted artifact root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'artifact-cwd-'));
    writeFileSync(join(outside, 'result.txt'), 'outside');
    const res = resolveArtifact(root, outside, 'result.txt');
    expect(res).toEqual({ ok: false, error: 'artifact escapes workspace' });
    rmSync(outside, { recursive: true, force: true });
  });
});
