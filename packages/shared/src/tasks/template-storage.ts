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
import { getBundledAssetsDir } from '../utils/paths.ts';
import { SLUG_RE, TaskSpecSchema, type TaskSpec } from './schema.ts';
import { parseTaskYaml, serializeTaskYaml } from './storage.ts';
import type { ValidationResult } from '../config/validators.ts';

const TEMPLATES_DIR = 'task-templates';
const TEMPLATE_FILE = 'template.yaml';

export interface LoadedTaskTemplate extends ValidationResult {
  spec?: TaskSpec;
  yaml: string;
  builtIn: boolean;
}

export interface TaskTemplateSummary {
  slug: string;
  title: string;
  builtIn: boolean;
}

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

/** App-shipped task templates. Workspace templates with the same slug take precedence. */
export function getBundledTaskTemplatesRoot(): string | undefined {
  const fromAssets = getBundledAssetsDir(TEMPLATES_DIR);
  if (fromAssets) return fromAssets;

  const candidates = [
    join(process.cwd(), 'apps', 'electron', 'resources', TEMPLATES_DIR),
    join(process.cwd(), 'resources', TEMPLATES_DIR),
    join(process.cwd(), '..', '..', 'apps', 'electron', 'resources', TEMPLATES_DIR),
  ];
  return candidates.find((dir) => existsSync(dir));
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load + validate a template.yaml. Returns null if no file exists. */
export function loadTaskTemplate(
  workspaceRoot: string,
  slug: string,
): LoadedTaskTemplate | null {
  if (!SLUG_RE.test(slug)) return null;
  const path = taskTemplateYamlPath(workspaceRoot, slug);
  if (!existsSync(path)) return null;
  const yaml = readFileSync(path, 'utf-8');
  return { ...parseTaskYaml(yaml), yaml, builtIn: false };
}

/** Load an app-shipped template. `bundledRoot` is injectable for deterministic tests. */
export function loadBundledTaskTemplate(
  slug: string,
  bundledRoot = getBundledTaskTemplatesRoot(),
): LoadedTaskTemplate | null {
  if (!SLUG_RE.test(slug) || !bundledRoot) return null;
  const path = join(bundledRoot, slug, TEMPLATE_FILE);
  if (!existsSync(path)) return null;
  const yaml = readFileSync(path, 'utf-8');
  return { ...parseTaskYaml(yaml), yaml, builtIn: true };
}

/** Resolve a workspace override first, then fall back to the app-shipped template. */
export function loadAvailableTaskTemplate(
  workspaceRoot: string,
  slug: string,
  bundledRoot = getBundledTaskTemplatesRoot(),
): LoadedTaskTemplate | null {
  return loadTaskTemplate(workspaceRoot, slug) ?? loadBundledTaskTemplate(slug, bundledRoot);
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

/** List workspace and app-shipped templates, with workspace templates shadowing equal slugs. */
export function listAvailableTaskTemplates(
  workspaceRoot: string,
  bundledRoot = getBundledTaskTemplatesRoot(),
): TaskTemplateSummary[] {
  const bySlug = new Map<string, TaskTemplateSummary>();
  if (bundledRoot && existsSync(bundledRoot)) {
    for (const entry of readdirSync(bundledRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SLUG_RE.test(entry.name)) continue;
      const loaded = loadBundledTaskTemplate(entry.name, bundledRoot);
      if (!loaded) continue;
      bySlug.set(entry.name, {
        slug: entry.name,
        title: loaded.spec?.title?.trim() || entry.name,
        builtIn: true,
      });
    }
  }
  for (const template of listTaskTemplates(workspaceRoot)) {
    bySlug.set(template.slug, { ...template, builtIn: false });
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
