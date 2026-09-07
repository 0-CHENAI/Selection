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

  it('refuses explicit and implicit v3 downgrades without changing the saved task', () => {
    const saved = saveTaskDocument(root, `schema_version: 3\n${V1}`, null);
    for (const yaml of [V1, `schema_version: 2\n${V1}`]) {
      expect(() => saveTaskDocument(root, yaml, saved.etag)).toThrow('Refusing to downgrade');
      expect(loadTaskDocument(root, 'demo')!.yaml).toBe(saved.yaml);
    }
  });

  it('does not create migration history when confirmation is missing', () => {
    const saved = saveTaskDocument(root, `schema_version: 2\n${V1}`, null);
    expect(() => saveTaskDocument(root, `schema_version: 3\n${V1}`, saved.etag)).toThrow('without confirmation');
    expect(existsSync(join(taskDir(root, 'demo'), '.history'))).toBe(false);
    expect(loadTaskDocument(root, 'demo')!.yaml).toBe(saved.yaml);
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

  it('rejects nested unknown fields on a v2 file instead of stripping them', () => {
    const doc = parseTaskDocument(`schema_version: 2
id: demo
title: Demo
goal: g
defaults:
  permissionMode: safe
  surprise: true
nodes:
  - id: a
    prompt: hello
    retry:
      limit: 1
      backoff:
        base: 1
        mystery: 2
    outputs:
      - name: result
        typo_required: true
`);
    expect(doc.valid).toBe(false);
    expect(doc.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        'defaults.surprise',
        'nodes.0.retry.backoff.mystery',
        'nodes.0.outputs.0.typo_required',
      ]),
    );
  });

  it('refuses v2 concurrency above eight and replicas without aggregation', () => {
    const overParallel = parseTaskDocument(`schema_version: 2
id: demo
title: Demo
goal: g
max_parallel: 9
nodes:
  - id: a
    prompt: hello
`);
    expect(overParallel.valid).toBe(false);
    expect(overParallel.errors.some((error) => error.message.includes('hard cap of 8'))).toBe(true);

    const replicas = parseTaskDocument(`schema_version: 2
id: demo
title: Demo
goal: g
nodes:
  - id: a
    prompt: hello
    replicas: 2
`);
    expect(replicas.valid).toBe(false);
    expect(replicas.errors.some((error) => error.message.includes('must declare an aggregate mode'))).toBe(true);
  });

  it('refuses permission escalation and persisted sensitive defaults', () => {
    const escalation = parseTaskDocument(`schema_version: 2
id: demo
title: Demo
goal: g
defaults:
  permissionMode: safe
nodes:
  - id: a
    prompt: hello
    permissionMode: allow-all
`);
    expect(escalation.valid).toBe(false);
    expect(escalation.errors.some((error) => error.message.includes('exceeds task ceiling safe'))).toBe(true);

    const secretDefault = parseTaskDocument(`schema_version: 2
id: demo
title: Demo
goal: g
params:
  - name: token
    sensitive: true
    default: secret
nodes:
  - id: a
    prompt: hello
`);
    expect(secretDefault.valid).toBe(false);
    expect(secretDefault.errors.some((error) => error.message.includes('cannot define a persisted default'))).toBe(true);
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

  it('migrates the known v1 type alias while keeping v2 strict', () => {
    const legacy = `id: demo
title: Demo
goal: g
nodes:
  - id: a
    type: session
    prompt: hello
`;
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), legacy);
    const before = loadTaskDocument(root, 'demo')!;
    const saved = saveTaskDocument(root, legacy, before.etag);
    expect(saved.sourceVersion).toBe(2);
    expect(saved.yaml).toContain('kind: session');
    expect(saved.yaml).not.toContain('type: session');

    expect(parseTaskDocument(legacy.replace('id: demo', 'schema_version: 2\nid: demo')).valid).toBe(false);
  });

  it('refuses to overwrite when etag does not match', () => {
    mkdirSync(taskDir(root, 'demo'), { recursive: true });
    writeFileSync(taskYamlPath(root, 'demo'), V1);
    expect(() => saveTaskDocument(root, V1, 'deadbeef')).toThrow(TaskEtagConflictError);
  });
});
