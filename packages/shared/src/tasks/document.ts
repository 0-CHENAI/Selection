/**
 * Versioned task.yaml reader/writer.
 *
 * v1 files (no schema_version) stay on disk until the first explicit v2 save.
 * The editor may hold an in-memory migration; the runner still uses sourceVersion.
 */
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { atomicWriteFileSync, stripBom } from '../utils/files.ts';
import type { ValidationIssue, ValidationResult } from '../config/validators.ts';
import { parseTaskSpec, TaskSpecSchema, type TaskSpec } from './schema.ts';
import { etagForYaml, TaskEtagConflictError } from './etag.ts';
import { taskDir, taskYamlPath, serializeTaskYaml } from './storage.ts';
import { validateTaskSpec } from './validate.ts';

export interface LoadedTaskDocument {
  slug: string;
  yaml: string;
  etag: string;
  sourceVersion: 1 | 2;
  spec?: TaskSpec;
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  migrationWarnings: string[];
}

const TASK_FILE = 'task.yaml';

function issue(path: string, message: string, severity: 'error' | 'warning' = 'error'): ValidationIssue {
  return { file: TASK_FILE, path, message, severity };
}

function unknownKeys(raw: unknown, allowed: Set<string>, path: string): ValidationIssue[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: ValidationIssue[] = [];
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) out.push(issue(`${path}.${key}`, `Unknown field "${key}"`));
  }
  return out;
}

const TASK_KEYS = new Set([
  'schema_version',
  'id',
  'title',
  'goal',
  'acceptance_criteria',
  'project',
  'cwd',
  'runner',
  'sources',
  'skills',
  'defaults',
  'params',
  'token_budget',
  'max_parallel',
  'max_iterations',
  'nodes',
  'outputs',
  'ui',
]);

const NODE_KEYS = new Set([
  'id',
  'title',
  'prompt',
  'kind',
  'type',
  'model',
  'llmConnection',
  'permissionMode',
  'labels',
  'status',
  'depends_on',
  'inputs',
  'outputs',
  'when',
  'trigger',
  'replicas',
  'aggregate',
  'loop',
  'for_each',
  'max_parallel',
  'retry',
  'timeout',
  'cache',
  'approval',
  'route',
]);

const DEFAULT_KEYS = new Set(['model', 'llmConnection', 'permissionMode']);
const PARAM_KEYS = new Set(['name', 'type', 'default', 'enum', 'sensitive']);
const INPUT_REF_KEYS = new Set(['from', 'summarize']);
const OUTPUT_DECL_KEYS = new Set(['name', 'kind', 'type', 'enum', 'required', 'description']);
const RETRY_KEYS = new Set(['limit', 'backoff', 'when']);
const BACKOFF_KEYS = new Set(['base', 'factor', 'max']);
const LOOP_KEYS = new Set(['until', 'max', 'else', 'carry']);
const ROUTE_KEYS = new Set(['cases', 'default']);
const ROUTE_CASE_KEYS = new Set(['when', 'goto']);
const CONDITION_KEYS = new Set(['ref', 'op', 'value', 'all', 'any', 'not']);
const UI_KEYS = new Set(['layout']);
const LAYOUT_KEYS = new Set(['direction', 'nodes', 'viewport']);
const POSITION_KEYS = new Set(['x', 'y']);
const VIEWPORT_KEYS = new Set(['x', 'y', 'zoom']);

function conditionUnknownFields(raw: unknown, path: string): ValidationIssue[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const issues = unknownKeys(raw, CONDITION_KEYS, path);
  const condition = raw as { all?: unknown; any?: unknown; not?: unknown };
  if (Array.isArray(condition.all)) {
    condition.all.forEach((item, i) => issues.push(...conditionUnknownFields(item, `${path}.all.${i}`)));
  }
  if (Array.isArray(condition.any)) {
    condition.any.forEach((item, i) => issues.push(...conditionUnknownFields(item, `${path}.any.${i}`)));
  }
  if (condition.not !== undefined) issues.push(...conditionUnknownFields(condition.not, `${path}.not`));
  return issues;
}

function v2UnknownFields(raw: unknown): ValidationIssue[] {
  const issues = unknownKeys(raw, TASK_KEYS, 'root');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return issues;
  const task = raw as Record<string, unknown>;
  issues.push(...unknownKeys(task.defaults, DEFAULT_KEYS, 'defaults'));
  if (Array.isArray(task.params)) {
    task.params.forEach((param, i) => issues.push(...unknownKeys(param, PARAM_KEYS, `params.${i}`)));
  }
  const ui = task.ui;
  issues.push(...unknownKeys(ui, UI_KEYS, 'ui'));
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    const layout = (ui as { layout?: unknown }).layout;
    issues.push(...unknownKeys(layout, LAYOUT_KEYS, 'ui.layout'));
    if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
      const layoutRecord = layout as { nodes?: unknown; viewport?: unknown };
      if (layoutRecord.nodes && typeof layoutRecord.nodes === 'object' && !Array.isArray(layoutRecord.nodes)) {
        for (const [id, position] of Object.entries(layoutRecord.nodes as Record<string, unknown>)) {
          issues.push(...unknownKeys(position, POSITION_KEYS, `ui.layout.nodes.${id}`));
        }
      }
      issues.push(...unknownKeys(layoutRecord.viewport, VIEWPORT_KEYS, 'ui.layout.viewport'));
    }
  }

  const nodes = task.nodes;
  if (!Array.isArray(nodes)) return issues;
  nodes.forEach((node, i) => {
    const path = `nodes.${i}`;
    issues.push(...unknownKeys(node, NODE_KEYS, path));
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    if (record.inputs && typeof record.inputs === 'object' && !Array.isArray(record.inputs)) {
      for (const [name, input] of Object.entries(record.inputs as Record<string, unknown>)) {
        issues.push(...unknownKeys(input, INPUT_REF_KEYS, `${path}.inputs.${name}`));
      }
    }
    if (Array.isArray(record.outputs)) {
      record.outputs.forEach((output, outputIndex) => {
        issues.push(...unknownKeys(output, OUTPUT_DECL_KEYS, `${path}.outputs.${outputIndex}`));
      });
    }
    issues.push(...unknownKeys(record.retry, RETRY_KEYS, `${path}.retry`));
    if (record.retry && typeof record.retry === 'object' && !Array.isArray(record.retry)) {
      issues.push(
        ...unknownKeys((record.retry as { backoff?: unknown }).backoff, BACKOFF_KEYS, `${path}.retry.backoff`),
      );
    }
    issues.push(...unknownKeys(record.loop, LOOP_KEYS, `${path}.loop`));
    if (record.loop && typeof record.loop === 'object' && !Array.isArray(record.loop)) {
      issues.push(...conditionUnknownFields((record.loop as { until?: unknown }).until, `${path}.loop.until`));
    }
    issues.push(...conditionUnknownFields(record.when, `${path}.when`));
    issues.push(...unknownKeys(record.route, ROUTE_KEYS, `${path}.route`));
    if (record.route && typeof record.route === 'object' && !Array.isArray(record.route)) {
      const cases = (record.route as { cases?: unknown }).cases;
      if (Array.isArray(cases)) {
        cases.forEach((routeCase, caseIndex) => {
          const casePath = `${path}.route.cases.${caseIndex}`;
          issues.push(...unknownKeys(routeCase, ROUTE_CASE_KEYS, casePath));
          if (routeCase && typeof routeCase === 'object' && !Array.isArray(routeCase)) {
            issues.push(
              ...conditionUnknownFields((routeCase as { when?: unknown }).when, `${casePath}.when`),
            );
          }
        });
      }
    }
  });
  return issues;
}

export function parseTaskDocument(yamlText: string, slug = ''): LoadedTaskDocument {
  const yaml = stripBom(yamlText);
  const etag = etagForYaml(yaml);
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (e) {
    return {
      slug,
      yaml,
      etag,
      sourceVersion: 1,
      valid: false,
      errors: [issue('root', `Invalid YAML: ${(e as Error).message}`)],
      warnings: [],
      migrationWarnings: [],
    };
  }

  const sourceVersion: 1 | 2 =
    raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { schema_version?: unknown }).schema_version === 2
      ? 2
      : 1;

  const parsed = parseTaskSpec(raw);
  const graph = parsed.success ? validateTaskSpec(parsed.data) : { valid: false, errors: [], warnings: [] };
  const errors = [
    ...(parsed.success ? [] : parsed.error.issues.map((i) => issue(i.path.join('.') || 'root', i.message))),
    ...graph.errors,
  ];
  const warnings = [...graph.warnings];
  const migrationWarnings: string[] = [];

  if (sourceVersion === 2) {
    errors.push(...v2UnknownFields(raw));
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (!('schema_version' in (raw as object))) {
      migrationWarnings.push('No schema_version; treated as v1. First save will write schema_version: 2 and backup the original YAML.');
    }
  }

  const spec = parsed.success ? parsed.data : undefined;
  return {
    slug: slug || spec?.id || '',
    yaml,
    etag,
    sourceVersion,
    spec,
    valid: errors.length === 0 && !!spec,
    errors,
    warnings,
    migrationWarnings,
  };
}

export function loadTaskDocument(workspaceRoot: string, slug: string): LoadedTaskDocument | null {
  const path = taskYamlPath(workspaceRoot, slug);
  if (!existsSync(path)) return null;
  return parseTaskDocument(readFileSync(path, 'utf-8'), slug);
}

export function backupTaskYaml(workspaceRoot: string, slug: string, yaml: string): string {
  const dir = join(taskDir(workspaceRoot, slug), '.history');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(dir, `${stamp}.yaml`);
  atomicWriteFileSync(dest, yaml);
  return dest;
}

export function saveTaskDocument(
  workspaceRoot: string,
  yaml: string,
  expectedEtag: string | null,
): LoadedTaskDocument {
  const incoming = parseTaskDocument(yaml);
  if (!incoming.valid || !incoming.spec) {
    throw new Error(`Refusing to save invalid task: ${incoming.errors.map((e) => e.message).join('; ')}`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(stripBom(yaml));
  } catch (e) {
    throw new Error(`Refusing to save invalid task: ${(e as Error).message}`);
  }
  const unknown = v2UnknownFields(raw);
  if (unknown.length) {
    throw new Error(`Refusing to save invalid task: ${unknown.map((e) => e.message).join('; ')}`);
  }
  const slug = incoming.spec.id;
  const existing = loadTaskDocument(workspaceRoot, slug);
  if (existing) {
    if (expectedEtag == null) {
      throw new TaskEtagConflictError('', existing.etag);
    }
    if (existing.etag !== expectedEtag) {
      throw new TaskEtagConflictError(expectedEtag, existing.etag);
    }
    if (existing.sourceVersion === 1) {
      backupTaskYaml(workspaceRoot, slug, existing.yaml);
    }
  }
  const spec: TaskSpec = {
    ...incoming.spec,
    schema_version: 2,
    nodes: incoming.spec.nodes.map((n) => (n.kind === 'orchestrator' ? { ...n, kind: 'session' as const } : n)),
  };
  // Re-parse through the v1-compatible schema after stamping version so defaults apply.
  const stamped = TaskSpecSchema.parse(spec);
  const body = serializeTaskYaml(stamped);
  mkdirSync(taskDir(workspaceRoot, slug), { recursive: true });
  atomicWriteFileSync(taskYamlPath(workspaceRoot, slug), body);
  return parseTaskDocument(body, slug);
}
