import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
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
    expect(res.artifact.scope).toBeUndefined();
    expect(res.artifact.mime).toBe('text/markdown');
    expect(res.artifact.size).toBe(5);
    expect(res.artifact.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a symlink that escapes the workspace', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'nope');
    symlinkSync(outside, join(root, 'link'), 'junction');
    const res = resolveArtifact(root, undefined, join('link', 'secret.txt'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/escapes/);
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects missing files', () => {
    expect(resolveArtifact(root, undefined, 'missing.bin').ok).toBe(false);
  });

  it('accepts an absolute path inside the workspace', () => {
    const absolute = join(root, 'note.md');
    writeFileSync(absolute, 'hello');
    const res = resolveArtifact(root, undefined, absolute);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.artifact.path).toBe('note.md');
    expect(res.artifact.scope).toBeUndefined();
  });

  it('accepts an absolute workspace path when an external task cwd is configured', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'artifact-cwd-'));
    const absolute = join(root, 'note.md');
    writeFileSync(absolute, 'hello');
    const res = resolveArtifact(root, cwd, absolute);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.artifact.path).toBe('note.md');
      expect(res.artifact.scope).toBeUndefined();
    }
    rmSync(cwd, { recursive: true, force: true });
  });

  it('records a cwd-relative path for a file inside an external task cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'artifact-cwd-'));
    writeFileSync(join(cwd, 'result.txt'), 'outside');
    const res = resolveArtifact(root, cwd, 'result.txt');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.artifact.path).toBe('result.txt');
      expect(res.artifact.scope).toBe('cwd');
    }
    rmSync(cwd, { recursive: true, force: true });
  });

  it('accepts an absolute path inside an external task cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'artifact-cwd-'));
    const absolute = join(cwd, 'result.txt');
    writeFileSync(absolute, 'outside');
    const res = resolveArtifact(root, cwd, absolute);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.artifact.path).toBe('result.txt');
      expect(res.artifact.scope).toBe('cwd');
    }
    rmSync(cwd, { recursive: true, force: true });
  });

  it('rejects a file outside both the workspace and task cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'artifact-cwd-'));
    const outside = mkdtempSync(join(tmpdir(), 'artifact-outside-'));
    const absolute = join(outside, 'secret.txt');
    writeFileSync(absolute, 'nope');
    const res = resolveArtifact(root, cwd, absolute);
    expect(res).toEqual({ ok: false, error: 'artifact escapes allowed roots' });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects a relative path that escapes the task cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'artifact-cwd-'));
    const outside = mkdtempSync(join(tmpdir(), 'artifact-outside-'));
    const absolute = join(outside, 'secret.txt');
    writeFileSync(absolute, 'nope');
    const res = resolveArtifact(root, cwd, relative(cwd, absolute));
    expect(res).toEqual({ ok: false, error: 'artifact escapes allowed roots' });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects a cwd symlink that escapes both allowed roots', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'artifact-cwd-'));
    const outside = mkdtempSync(join(tmpdir(), 'artifact-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'nope');
    symlinkSync(outside, join(cwd, 'link'), 'junction');
    const res = resolveArtifact(root, cwd, join('link', 'secret.txt'));
    expect(res).toEqual({ ok: false, error: 'artifact escapes allowed roots' });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});
