/**
 * Workspace orchestration templates.
 *
 * Layout (outside `tasks/` so listTaskSlugs never treats these as live tasks):
 *   {workspaceRoot}/templates/<slug>/template.yaml
 *
 * A template is metadata plus a sanitized V3 TaskSpec. Runs, sessions, ETags,
 * and sensitive param values stay on instantiated tasks only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { atomicWriteFileSync, stripBom } from '../utils/files.ts';
import { SLUG_RE, type TaskSpec } from './schema.ts';
import { uniqueTaskSlug } from './slug.ts';
import { parseTaskImport } from './document.ts';
import { listTaskSlugs, serializeTaskYaml } from './storage.ts';

const TEMPLATES_DIR = 'templates';
const TEMPLATE_FILE = 'template.yaml';

export class TaskTemplateConflictError extends Error {
  readonly field: 'id' | 'name';
  constructor(field: 'id' | 'name', value: string) {
    super(
      field === 'name'
        ? `A template named "${value}" already exists.`
        : `A template with id "${value}" already exists.`,
    );
    this.name = 'TaskTemplateConflictError';
    this.field = field;
  }
}

const TemplateDocumentSchema = z.object({
  id: z.string().regex(SLUG_RE),
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  source_task_slug: z.string().optional(),
  spec: z.unknown(),
});

export interface TaskTemplateSummary {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
  sourceTaskSlug?: string;
}

export interface TaskTemplateRecord extends TaskTemplateSummary {
  spec: TaskSpec;
  yaml: string;
}

export function taskTemplatesRoot(workspaceRoot: string): string {
  return join(workspaceRoot, TEMPLATES_DIR);
}

export function taskTemplateDir(workspaceRoot: string, id: string): string {
  if (!SLUG_RE.test(id) || id.includes('..')) {
    throw new Error(`Invalid template id "${id}"`);
  }
  const root = resolve(workspaceRoot, TEMPLATES_DIR);
  const dir = resolve(root, id);
  const rel = relative(root, dir);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Invalid template id "${id}"`);
  }
  return dir;
}

export function taskTemplateYamlPath(workspaceRoot: string, id: string): string {
  return join(taskTemplateDir(workspaceRoot, id), TEMPLATE_FILE);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanTags(tags: string[] | undefined): string[] | undefined {
  const cleaned = [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  return cleaned.length ? cleaned : undefined;
}

/** Remove sensitive defaults from source YAML before V3 validation. */
export function redactTemplateSource(yaml: string): string {
  let raw: unknown;
  try {
    raw = parseYaml(stripBom(yaml));
  } catch {
    return yaml;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return yaml;
  const document = raw as Record<string, unknown>;
  if (Array.isArray(document.params)) {
    document.params = document.params.map((param) => {
      if (!param || typeof param !== 'object' || Array.isArray(param)) return param;
      const next = { ...(param as Record<string, unknown>) };
      if (next.sensitive) delete next.default;
      return next;
    });
  }
  return stringifyYaml(document);
}

/** Strip run/session residue and sensitive defaults. Force V3. */
export function sanitizeTemplateSpec(spec: TaskSpec): TaskSpec {
  const params = spec.params?.map((param) => {
    if (!param.sensitive) return { ...param };
    const { default: _omit, ...rest } = param;
    return rest;
  });
  return {
    ...spec,
    schema_version: 3,
    runner: spec.runner ?? 'conduct',
    params,
    project: undefined,
    cwd: undefined,
    nodes: spec.nodes.map((node) => ({
      ...node,
      status: undefined,
      cache: node.cache === 'pure' ? 'run-pure' : node.cache,
    })),
  };
}

export function instantiateTemplateSpec(
  spec: TaskSpec,
  taken: ReadonlySet<string>,
  options: { name?: string; projectId?: string } = {},
): TaskSpec {
  const id = uniqueTaskSlug(options.name || spec.title || spec.id, taken);
  const next: TaskSpec = {
    ...spec,
    schema_version: 3,
    id,
    title: spec.title || options.name || spec.id,
  };
  if (options.projectId) next.project = options.projectId;
  else delete next.project;
  return next;
}

function importedSpec(raw: unknown): ReturnType<typeof parseTaskImport> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return parseTaskImport('');
  }
  return parseTaskImport(stringifyYaml(raw));
}

function toSummary(id: string, name: string, spec: TaskSpec, meta: {
  description?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
  source_task_slug?: string;
}): TaskTemplateSummary {
  return {
    id,
    name,
    description: meta.description,
    tags: meta.tags,
    nodeCount: spec.nodes.length,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
    sourceTaskSlug: meta.source_task_slug && SLUG_RE.test(meta.source_task_slug)
      ? meta.source_task_slug
      : undefined,
  };
}

function parseTemplateFile(yaml: string): TaskTemplateRecord | null {
  let raw: unknown;
  try {
    raw = parseYaml(stripBom(yaml));
  } catch {
    return null;
  }
  const parsed = TemplateDocumentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const imported = importedSpec(parsed.data.spec);
  if (!imported.valid || !imported.spec || imported.sourceVersion !== 3) return null;
  const spec = sanitizeTemplateSpec(imported.spec);
  return {
    ...toSummary(parsed.data.id, parsed.data.name, spec, parsed.data),
    spec,
    yaml: serializeTaskYaml(spec),
  };
}

export function loadTaskTemplate(workspaceRoot: string, id: string): TaskTemplateRecord | null {
  if (!SLUG_RE.test(id) || id.includes('..')) return null;
  const path = taskTemplateYamlPath(workspaceRoot, id);
  if (!existsSync(path)) return null;
  const loaded = parseTemplateFile(readFileSync(path, 'utf-8'));
  return loaded?.id === id ? loaded : null;
}

export function listTaskTemplateSummaries(workspaceRoot: string): TaskTemplateSummary[] {
  const root = taskTemplatesRoot(workspaceRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SLUG_RE.test(entry.name) && existsSync(join(root, entry.name, TEMPLATE_FILE)))
    .map((entry) => loadTaskTemplate(workspaceRoot, entry.name))
    .filter((item): item is TaskTemplateRecord => item != null)
    .map(({ spec: _spec, yaml: _yaml, ...summary }) => summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

export function saveTaskTemplate(
  workspaceRoot: string,
  input: {
    name: string;
    description?: string;
    tags?: string[];
    sourceTaskSlug?: string;
    yaml: string;
  },
): TaskTemplateRecord {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('A template name is required.');
  const imported = parseTaskImport(redactTemplateSource(input.yaml));
  if (!imported.valid || !imported.spec || imported.sourceVersion !== 3) {
    const detail = imported.errors.map((error) => error.message).join('; ') || 'YAML import requires explicit schema_version: 3.';
    throw new Error(detail);
  }
  const spec = sanitizeTemplateSpec(imported.spec);
  const leftoverSecret = spec.params?.some((param) => param.sensitive && param.default !== undefined);
  if (leftoverSecret) throw new Error('Sensitive parameter values cannot be stored in a template.');

  const existing = listTaskTemplateSummaries(workspaceRoot);
  if (existing.some((item) => normalizeName(item.name) === normalizeName(name))) {
    throw new TaskTemplateConflictError('name', name);
  }
  const id = uniqueTaskSlug(name, new Set(existing.map((item) => item.id)));
  const now = new Date().toISOString();
  const sourceTaskSlug = input.sourceTaskSlug && SLUG_RE.test(input.sourceTaskSlug)
    ? input.sourceTaskSlug
    : undefined;
  const record: TaskTemplateRecord = {
    ...toSummary(id, name, spec, {
      description: input.description?.trim() || undefined,
      tags: cleanTags(input.tags),
      created_at: now,
      updated_at: now,
      source_task_slug: sourceTaskSlug,
    }),
    spec,
    yaml: serializeTaskYaml(spec),
  };
  const document = {
    id,
    name,
    ...(record.description ? { description: record.description } : {}),
    ...(record.tags ? { tags: record.tags } : {}),
    created_at: now,
    updated_at: now,
    ...(sourceTaskSlug ? { source_task_slug: sourceTaskSlug } : {}),
    spec,
  };
  ensureDir(taskTemplateDir(workspaceRoot, id));
  atomicWriteFileSync(taskTemplateYamlPath(workspaceRoot, id), stringifyYaml(document));
  return record;
}

export function deleteTaskTemplate(workspaceRoot: string, id: string): boolean {
  if (!SLUG_RE.test(id) || id.includes('..')) return false;
  const dir = taskTemplateDir(workspaceRoot, id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Create a new task spec from a template without mutating the template or existing tasks. */
export function specFromTemplate(
  workspaceRoot: string,
  templateId: string,
  projectId?: string,
): TaskSpec {
  const loaded = loadTaskTemplate(workspaceRoot, templateId);
  if (!loaded) throw new Error(`Template "${templateId}" was not found.`);
  return instantiateTemplateSpec(
    loaded.spec,
    new Set(listTaskSlugs(workspaceRoot)),
    { name: loaded.name, projectId },
  );
}
