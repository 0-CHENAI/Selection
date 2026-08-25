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
});
