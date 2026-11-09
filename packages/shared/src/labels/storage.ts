/**
 * Label Storage
 *
 * Filesystem-based storage for workspace label configurations.
 * Labels are stored at {workspaceRootPath}/labels/config.json
 *
 * Hierarchy: Labels form a nested JSON tree. IDs are simple slugs.
 * New workspaces are seeded with default Chinese labels (内容 group + 优先级).
 * Labels are visual by color only (colored circles in the UI).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WorkspaceLabelConfig, LabelConfig } from './types.ts';
import { flattenLabels, findLabelById } from './tree.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { migrateLabelColors } from '../colors/migrate.ts';
import { debug } from '../utils/debug.ts';

const LABEL_CONFIG_DIR = 'labels';
const LABEL_CONFIG_FILE = 'labels/config.json';

/**
 * Get default label configuration (Chinese display names).
 *
 * Starter set:
 * - 内容 (purple family): 写作, 研究, 设计
 * - 优先级 (number-valued)
 *
 * Removed from defaults: Development (+ Code/Bug/Automation), Project.
 * Children use hue-shifted shades of their parent color for hierarchy.
 */
export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [
      {
        id: 'content',
        name: '内容',
        color: { light: '#8B5CF6', dark: '#A78BFA' },
        children: [
          {
            id: 'writing',
            name: '写作',
            color: { light: '#7C3AED', dark: '#C4B5FD' }, // deeper violet
          },
          {
            id: 'research',
            name: '研究',
            color: { light: '#A855F7', dark: '#C084FC' }, // lighter purple
          },
          {
            id: 'design',
            name: '设计',
            color: { light: '#D946EF', dark: '#E879F9' }, // fuchsia shift
          },
        ],
      },
      {
        id: 'priority',
        name: '优先级',
        color: { light: '#F59E0B', dark: '#FBBF24' },
        valueType: 'number',
      },
    ],
  };
}

/** Built-in seed labels that should always display Chinese names. */
const SEED_LABEL_ZH_NAMES: Record<string, string> = {
  content: '内容',
  writing: '写作',
  research: '研究',
  design: '设计',
  priority: '优先级',
  // Legacy seed children (kept if user still has them under other parents)
  code: '代码',
  bug: '缺陷',
  automation: '自动化',
};

/**
 * Label IDs removed from the product defaults.
 * Also matches by display name for user-created copies of the old seed.
 */
const REMOVED_SEED_LABEL_IDS = new Set([
  'development',
  'project',
  'github-actions-monitor',
  'github-actions',
  'actions-monitor',
]);

const REMOVED_SEED_LABEL_NAMES = new Set([
  'development',
  'project',
  'github actions monitor',
  'github actions',
  'actions monitor',
]);

/**
 * Migrate legacy English seed labels → Chinese, and drop removed seed groups.
 * Returns true when the config was modified and should be persisted.
 *
 * Safe for user-custom labels: only renames known seed IDs, only removes
 * known legacy seed IDs/names.
 */
export function migrateDefaultLabelsToChinese(config: WorkspaceLabelConfig): boolean {
  let changed = false;

  const shouldRemove = (label: LabelConfig): boolean => {
    if (REMOVED_SEED_LABEL_IDS.has(label.id)) return true;
    if (REMOVED_SEED_LABEL_NAMES.has(label.name.trim().toLowerCase())) return true;
    return false;
  };

  const walk = (labels: LabelConfig[]): LabelConfig[] => {
    const next: LabelConfig[] = [];
    for (const label of labels) {
      if (shouldRemove(label)) {
        changed = true;
        continue;
      }

      const zhName = SEED_LABEL_ZH_NAMES[label.id];
      if (zhName && label.name !== zhName) {
        label.name = zhName;
        changed = true;
      }

      if (label.children && label.children.length > 0) {
        const children = walk(label.children);
        if (children.length !== label.children.length) {
          changed = true;
        }
        label.children = children.length > 0 ? children : undefined;
      }

      next.push(label);
    }
    return next;
  };

  config.labels = walk(config.labels);
  return changed;
}

/**
 * Load workspace label configuration.
 * Returns empty config if no file exists or parsing fails.
 * Auto-migrates old Tailwind color format to EntityColor on first load.
 * Migrates legacy English seed labels to Chinese and removes dropped seeds.
 */
export function loadLabelConfig(workspaceRootPath: string): WorkspaceLabelConfig {
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  // If no config file exists, seed with defaults and persist to disk.
  // This ensures existing workspaces (created before default labels existed) get populated.
  if (!existsSync(configPath)) {
    const defaults = getDefaultLabelConfig();
    debug('[loadLabelConfig] No config found, seeding with default labels');
    saveLabelConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    const config = readJsonFileSync<WorkspaceLabelConfig>(configPath);

    // Auto-migrate old Tailwind class colors (e.g., "text-accent") to new EntityColor format.
    // If migration occurs, write the updated config back to disk.
    let dirty = migrateLabelColors(config);

    // English seed labels → Chinese; drop Development / Project / GitHub Actions Monitor
    if (migrateDefaultLabelsToChinese(config)) {
      dirty = true;
    }

    if (dirty) {
      debug('[loadLabelConfig] Migrated label config, writing back');
      saveLabelConfig(workspaceRootPath, config);
    }

    return config;
  } catch (error) {
    debug('[loadLabelConfig] Failed to parse config:', error);
    return getDefaultLabelConfig();
  }
}

/**
 * Save workspace label configuration to disk.
 * Creates the labels directory if missing.
 */
export function saveLabelConfig(
  workspaceRootPath: string,
  config: WorkspaceLabelConfig
): void {
  const labelDir = join(workspaceRootPath, LABEL_CONFIG_DIR);
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  if (!existsSync(labelDir)) {
    mkdirSync(labelDir, { recursive: true });
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveLabelConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * Get the label tree (root-level labels with nested children).
 * Primary accessor for the UI — returns the tree structure as-is from config.
 */
export function listLabels(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return config.labels;
}

/**
 * Get all labels as a flat list (tree flattened depth-first).
 * Useful for lookups, session label validation, and non-hierarchical display.
 */
export function listLabelsFlat(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return flattenLabels(config.labels);
}

/**
 * Get a single label by ID (searches the entire tree).
 * Returns null if not found.
 */
export function getLabel(
  workspaceRootPath: string,
  labelId: string
): LabelConfig | null {
  const config = loadLabelConfig(workspaceRootPath);
  return findLabelById(config.labels, labelId) || null;
}

/**
 * Check if a label ID exists in this workspace (searches entire tree)
 */
export function isValidLabelId(
  workspaceRootPath: string,
  labelId: string
): boolean {
  const config = loadLabelConfig(workspaceRootPath);
  return !!findLabelById(config.labels, labelId);
}

/**
 * Validate label ID format.
 * Simple slug: lowercase alphanumeric + hyphens, no leading/trailing hyphens.
 * Examples: "bug", "frontend", "my-label"
 */
export function isValidLabelIdFormat(labelId: string): boolean {
  if (!labelId) return false;
  const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return SLUG_PATTERN.test(labelId);
}


