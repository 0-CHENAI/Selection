/**
 * Workspace-local task templates.
 *
 * Layout (intentionally outside `tasks/` so listTaskSlugs never treats these as live tasks):
 *   {workspaceRoot}/task-templates/<slug>/template.yaml
 *
 * A template is a session-less TaskSpec snapshot — nodes, deps, params, defaults.
 * Runs, child sessions, and orchestrator tiles live only on instantiated tasks.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { SLUG_RE, TaskSpecSchema, type TaskSpec } from './schema.ts';
import { parseTaskYaml, serializeTaskYaml } from './storage.ts';
import type { ValidationResult } from '../config/validators.ts';

const TEMPLATES_DIR = 'task-templates';
const TEMPLATE_FILE = 'template.yaml';

export function taskTemplatesRoot(workspaceRoot: string): string {
  return join(workspaceRoot, TEMPLATES_DIR);
}

export function taskTemplateDir(workspaceRoot: string, slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid template slug "${slug}"`);
  }
  return join(workspaceRoot, TEMPLATES_DIR, slug);
}

export function taskTemplateYamlPath(workspaceRoot: string, slug: string): string {
  return join(taskTemplateDir(workspaceRoot, slug), TEMPLATE_FILE);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load + validate a template.yaml. Returns null if no file exists. */
export function loadTaskTemplate(
  workspaceRoot: string,
  slug: string,
): (ValidationResult & { spec?: TaskSpec; yaml: string }) | null {
  if (!SLUG_RE.test(slug)) return null;
  const path = taskTemplateYamlPath(workspaceRoot, slug);
  if (!existsSync(path)) return null;
  const yaml = readFileSync(path, 'utf-8');
  return { ...parseTaskYaml(yaml), yaml };
}

/** Write a spec to disk as template.yaml. Validates the shape first; throws on invalid. */
export function saveTaskTemplateSpec(workspaceRoot: string, spec: TaskSpec): void {
  const parsed = TaskSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new Error(
      `Refusing to save invalid task template: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  ensureDir(taskTemplateDir(workspaceRoot, parsed.data.id));
  atomicWriteFileSync(taskTemplateYamlPath(workspaceRoot, parsed.data.id), serializeTaskYaml(parsed.data));
}

/** List template slugs (subdirectories of task-templates/ that contain a template.yaml). */
export function listTaskTemplateSlugs(workspaceRoot: string): string[] {
  const root = taskTemplatesRoot(workspaceRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SLUG_RE.test(d.name) && existsSync(join(root, d.name, TEMPLATE_FILE)))
    .map((d) => d.name)
    .sort();
}

/** Remove `task-templates/<slug>/`. Returns false when the slug is invalid or missing. */
export function deleteTaskTemplate(workspaceRoot: string, slug: string): boolean {
  if (!SLUG_RE.test(slug)) return false;
  const dir = taskTemplateDir(workspaceRoot, slug);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Slug + title for the create-mode picker. Invalid yaml still lists, titled by slug. */
export function listTaskTemplates(workspaceRoot: string): { slug: string; title: string }[] {
  return listTaskTemplateSlugs(workspaceRoot).map((slug) => {
    const loaded = loadTaskTemplate(workspaceRoot, slug);
    return { slug, title: loaded?.spec?.title?.trim() || slug };
  });
}
