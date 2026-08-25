import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseTaskSpec, type TaskSpec } from './schema.ts';
import { cloneTaskDefinition } from './clone.ts';
import { listTaskSlugs, saveTaskSpec, taskYamlPath } from './storage.ts';
import {
  deleteTaskTemplate,
  listTaskTemplates,
  listTaskTemplateSlugs,
  loadTaskTemplate,
  saveTaskTemplateSpec,
  taskTemplateYamlPath,
} from './template-storage.ts';

function specOf(raw: unknown): TaskSpec {
  const parsed = parseTaskSpec(raw);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

describe('task template storage', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'task-tpl-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('saves and lists templates outside tasks/', () => {
    const spec = cloneTaskDefinition(
      specOf({
        id: 'review',
        title: 'Review',
        goal: 'review the change',
        params: [{ name: 'token', sensitive: true, default: 'secret' }],
        nodes: [
          { id: 'read', prompt: 'read it' },
          { id: 'qa-typed', prompt: 'typed' },
        ],
      }),
      { id: 'review', title: 'Review' },
    );
    saveTaskTemplateSpec(root, spec);

    expect(listTaskTemplateSlugs(root)).toEqual(['review']);
    expect(listTaskTemplates(root)).toEqual([{ slug: 'review', title: 'Review' }]);
    expect(listTaskSlugs(root)).toEqual([]);
    expect(existsSync(taskTemplateYamlPath(root, 'review'))).toBe(true);
    expect(existsSync(taskYamlPath(root, 'review'))).toBe(false);

    const loaded = loadTaskTemplate(root, 'review');
    expect(loaded?.valid).toBe(true);
    expect(loaded?.spec?.nodes.map((n) => n.id)).toEqual(['read']);
    expect(loaded?.spec?.params).toEqual([{ name: 'token', sensitive: true }]);
  });

  it('does not treat live tasks as templates', () => {
    saveTaskSpec(
      root,
      specOf({
        id: 'live',
        title: 'Live',
        goal: 'g',
        nodes: [{ id: 'a', prompt: 'hello' }],
      }),
    );
    mkdirSync(join(root, 'task-templates', 'empty'), { recursive: true });
    writeFileSync(join(root, 'task-templates', 'empty', 'notes.txt'), 'nope');

    expect(listTaskSlugs(root)).toEqual(['live']);
    expect(listTaskTemplateSlugs(root)).toEqual([]);
    expect(loadTaskTemplate(root, 'live')).toBeNull();
  });

  it('rejects path-like slugs and ignores non-slug folders', () => {
    mkdirSync(join(root, 'task-templates', 'Not-Valid'), { recursive: true });
    writeFileSync(join(root, 'task-templates', 'Not-Valid', 'template.yaml'), 'id: x\n');
    expect(loadTaskTemplate(root, '../tasks/live')).toBeNull();
    expect(loadTaskTemplate(root, 'Not-Valid')).toBeNull();
    expect(listTaskTemplateSlugs(root)).toEqual([]);
  });

  it('overwrites the same template slug', () => {
    saveTaskTemplateSpec(
      root,
      specOf({
        id: 'review',
        title: 'Review',
        goal: 'g',
        nodes: [{ id: 'read', prompt: 'v1' }],
      }),
    );
    saveTaskTemplateSpec(
      root,
      specOf({
        id: 'review',
        title: 'Review v2',
        goal: 'g2',
        nodes: [{ id: 'read', prompt: 'v2' }],
      }),
    );
    expect(listTaskTemplates(root)).toEqual([{ slug: 'review', title: 'Review v2' }]);
    expect(loadTaskTemplate(root, 'review')?.spec?.nodes[0]?.prompt).toBe('v2');
  });

  it('deletes a template without touching live tasks', () => {
    saveTaskTemplateSpec(
      root,
      specOf({
        id: 'review',
        title: 'Review',
        goal: 'g',
        nodes: [{ id: 'read', prompt: 'v1' }],
      }),
    );
    saveTaskSpec(
      root,
      specOf({
        id: 'review',
        title: 'Review',
        goal: 'g',
        nodes: [{ id: 'read', prompt: 'live' }],
      }),
    );
    expect(deleteTaskTemplate(root, 'missing')).toBe(false);
    expect(deleteTaskTemplate(root, '../tasks/review')).toBe(false);
    expect(deleteTaskTemplate(root, 'review')).toBe(true);
    expect(listTaskTemplateSlugs(root)).toEqual([]);
    expect(existsSync(taskTemplateYamlPath(root, 'review'))).toBe(false);
    expect(listTaskSlugs(root)).toEqual(['review']);
    expect(existsSync(taskYamlPath(root, 'review'))).toBe(true);
  });
});
