import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseTaskDocument, loadTaskDocument, saveTaskDocument } from './document.ts';
import { TaskEtagConflictError } from './etag.ts';
import { taskDir, taskYamlPath } from './storage.ts';

const V1 = `id: demo
title: Demo
goal: g
nodes:
  - id: a
    prompt: hello
`;

describe('task document v1/v2', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'task-doc-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a v1 file as sourceVersion 1 and does not rewrite it', () => {
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), V1);
    const doc = loadTaskDocument(root, 'demo')!;
    expect(doc.sourceVersion).toBe(1);
    expect(doc.valid).toBe(true);
    expect(doc.migrationWarnings.length).toBeGreaterThan(0);
    expect(readFileSync(taskYamlPath(root, 'demo'), 'utf-8')).toBe(V1);
  });

  it('rejects unknown fields on a v2 file', () => {
    const doc = parseTaskDocument(`schema_version: 2
id: demo
title: Demo
goal: g
mystery: true
nodes:
  - id: a
    prompt: hello
`);
    expect(doc.sourceVersion).toBe(2);
    expect(doc.errors.some((e) => e.message.includes('Unknown field'))).toBe(true);
  });

  it('refuses to save unknown fields even when the source file is still v1', () => {
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), V1);
    const before = loadTaskDocument(root, 'demo')!;
    expect(() =>
      saveTaskDocument(
        root,
        `${V1}mystery: true\n`,
        before.etag,
      ),
    ).toThrow(/Unknown field/);
    expect(readFileSync(taskYamlPath(root, 'demo'), 'utf-8')).toBe(V1);
  });

  it('first v2 save backups the original yaml and writes schema_version', () => {
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), V1);
    const before = loadTaskDocument(root, 'demo')!;
    const saved = saveTaskDocument(root, V1, before.etag);
    expect(saved.sourceVersion).toBe(2);
    expect(saved.spec?.schema_version).toBe(2);
    const history = readdirSync(join(taskDir(root, 'demo'), '.history'));
    expect(history.length).toBe(1);
    expect(existsSync(taskYamlPath(root, 'demo'))).toBe(true);
  });

  it('refuses to overwrite when etag does not match', () => {
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), V1);
    expect(() => saveTaskDocument(root, V1, 'deadbeef')).toThrow(TaskEtagConflictError);
  });
});
