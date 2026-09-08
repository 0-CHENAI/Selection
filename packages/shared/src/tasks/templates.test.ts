import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseTaskSpec, type TaskSpec } from './schema.ts';
import { listTaskSlugs, saveTaskSpec, taskYamlPath } from './storage.ts';
import {
  deleteTaskTemplate,
  instantiateTemplateSpec,
  listAvailableTaskTemplateSummaries,
  listTaskTemplateSummaries,
  loadAvailableTaskTemplate,
  loadBundledTaskTemplate,
  loadTaskTemplate,
  sanitizeTemplateSpec,
  saveTaskTemplate,
  specFromAvailableTemplate,
  specFromTemplate,
  taskTemplateYamlPath,
  TaskTemplateConflictError,
} from './templates.ts';

function specOf(raw: unknown): TaskSpec {
  const parsed = parseTaskSpec(raw);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

const V3 = {
  schema_version: 3 as const,
  id: 'review',
  title: 'Review',
  goal: 'review the change',
  params: [{ name: 'token', type: 'string' as const, sensitive: true, default: 'secret' }],
  nodes: [
    { id: 'read', title: 'Read', prompt: 'read it', depends_on: [] as string[], permissionMode: 'ask' as const, model: 'demo' },
    { id: 'gate', title: 'Gate', kind: 'approval' as const, prompt: 'approve', depends_on: ['read'] },
  ],
};

describe('orchestration templates', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orch-tpl-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('saves a V3 template outside tasks/ and strips secrets', () => {
    const saved = saveTaskTemplate(root, {
      name: 'Code Review',
      description: 'Reusable review graph',
      tags: ['review', 'qa'],
      sourceTaskSlug: 'review',
      yaml: `schema_version: 3
id: review
title: Review
goal: review the change
params:
  - name: token
    type: string
    sensitive: true
    default: secret
nodes:
  - id: read
    prompt: read it
`,
    });
    expect(saved.id).toBe('code-review');
    expect(saved.nodeCount).toBe(1);
    expect(saved.spec.params).toEqual([{ name: 'token', type: 'string', sensitive: true }]);
    expect(saved.yaml).not.toContain('secret');
    expect(existsSync(taskTemplateYamlPath(root, 'code-review'))).toBe(true);
    expect(listTaskSlugs(root)).toEqual([]);
    expect(existsSync(taskYamlPath(root, 'code-review'))).toBe(false);
    expect(listTaskTemplateSummaries(root).map((item) => item.name)).toEqual(['Code Review']);
  });

  it('rejects legacy YAML, duplicate names, and path-like ids', () => {
    expect(() => saveTaskTemplate(root, {
      name: 'Legacy',
      yaml: 'id: old\ntitle: Old\ngoal: g\nnodes:\n  - id: a\n    prompt: p\n',
    })).toThrow('schema_version');
    saveTaskTemplate(root, {
      name: 'Review',
      yaml: 'schema_version: 3\nid: review\ntitle: Review\ngoal: g\nnodes:\n  - id: a\n    prompt: p\n',
    });
    expect(() => saveTaskTemplate(root, {
      name: 'review',
      yaml: 'schema_version: 3\nid: other\ntitle: Other\ngoal: g\nnodes:\n  - id: a\n    prompt: p\n',
    })).toThrow(TaskTemplateConflictError);
    expect(loadTaskTemplate(root, '../tasks/review')).toBeNull();
    expect(loadTaskTemplate(root, 'Not-Valid')).toBeNull();
  });

  it('does not treat live tasks as templates', () => {
    saveTaskSpec(root, specOf({
      schema_version: 3,
      id: 'live',
      title: 'Live',
      goal: 'g',
      nodes: [{ id: 'a', prompt: 'hello' }],
    }));
    mkdirSync(join(root, 'templates', 'empty'), { recursive: true });
    writeFileSync(join(root, 'templates', 'empty', 'notes.txt'), 'nope');
    expect(listTaskSlugs(root)).toEqual(['live']);
    expect(listTaskTemplateSummaries(root)).toEqual([]);
    expect(loadTaskTemplate(root, 'live')).toBeNull();
  });

  it('instantiates a new task id without rewriting the template or existing tasks', () => {
    saveTaskTemplate(root, {
      name: 'Review',
      yaml: 'schema_version: 3\nid: review\ntitle: Review\ngoal: g\nnodes:\n  - id: a\n    prompt: p\n',
    });
    saveTaskSpec(root, specOf({
      schema_version: 3,
      id: 'review',
      title: 'Live review',
      goal: 'g',
      nodes: [{ id: 'a', prompt: 'live' }],
    }));
    const spec = specFromTemplate(root, 'review', 'proj-1');
    expect(spec.id).toBe('review-2');
    expect(spec.project).toBe('proj-1');
    expect(loadTaskTemplate(root, 'review')?.spec.id).toBe('review');
    expect(listTaskSlugs(root)).toEqual(['review']);
  });

  it('deletes a template without touching live tasks', () => {
    saveTaskTemplate(root, {
      name: 'Review',
      yaml: 'schema_version: 3\nid: review\ntitle: Review\ngoal: g\nnodes:\n  - id: a\n    prompt: p\n',
    });
    saveTaskSpec(root, specOf({
      schema_version: 3,
      id: 'review',
      title: 'Review',
      goal: 'g',
      nodes: [{ id: 'a', prompt: 'live' }],
    }));
    expect(deleteTaskTemplate(root, 'missing')).toBe(false);
    expect(deleteTaskTemplate(root, '../tasks/review')).toBe(false);
    expect(deleteTaskTemplate(root, 'review')).toBe(true);
    expect(listTaskTemplateSummaries(root)).toEqual([]);
    expect(existsSync(taskTemplateYamlPath(root, 'review'))).toBe(false);
    expect(listTaskSlugs(root)).toEqual(['review']);
    expect(existsSync(taskYamlPath(root, 'review'))).toBe(true);
  });

  it('sanitizes sensitive defaults and instantiates a unique slug from the template name', () => {
    const spec = sanitizeTemplateSpec(specOf(V3));
    expect(spec.schema_version).toBe(3);
    expect(spec.params).toEqual([{ name: 'token', type: 'string', sensitive: true }]);
    const next = instantiateTemplateSpec(spec, new Set(['review', 'review-2']), { name: 'Review', projectId: 'p' });
    expect(next.id).toBe('review-3');
    expect(next.project).toBe('p');
    expect(spec.id).toBe('review');
  });

  it('lists and instantiates read-only app-shipped V3 templates', () => {
    const bundledRoot = join(root, 'bundled');
    const templateDir = join(bundledRoot, 'bundled-review');
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, 'template.yaml'), `
id: bundled-review
name: Bundled Review
description: App-shipped workflow
tags: [review]
created_at: 2026-09-08T00:00:00.000Z
updated_at: 2026-09-08T00:00:00.000Z
spec:
  schema_version: 3
  id: bundled-review
  title: Bundled Review
  goal: review the change
  nodes:
    - id: read
      prompt: read it
`);

    expect(loadBundledTaskTemplate('bundled-review', bundledRoot)?.builtIn).toBe(true);
    expect(loadAvailableTaskTemplate(root, 'bundled-review', bundledRoot)?.name).toBe('Bundled Review');
    expect(listAvailableTaskTemplateSummaries(root, bundledRoot)).toEqual([
      expect.objectContaining({ id: 'bundled-review', builtIn: true, nodeCount: 1 }),
    ]);
    expect(specFromAvailableTemplate(root, 'bundled-review', 'proj-1', bundledRoot)).toMatchObject({
      schema_version: 3,
      id: 'bundled-review',
      project: 'proj-1',
    });
    expect(deleteTaskTemplate(root, 'bundled-review')).toBe(false);
  });
});
