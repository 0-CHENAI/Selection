/**
 * Resource Bundle Types
 *
 * Portable format for exporting/importing workspace resources
 * (sources, skills, automations) between workspaces.
 *
 * Follows the same bundle pattern as session export/import.
 */

import type { BundleFile } from '../utils/bundle-files.ts'
import type { FolderSourceConfig } from '../sources/types.ts'
import type { AutomationMatcher } from '../automations/types.ts'

// ============================================================
// Bundle Format
// ============================================================

/**
 * Portable representation of workspace resources.
 * JSON envelope with base64-encoded files — same pattern as SessionBundle.
 */
export interface ResourceBundle {
  /** Discriminator added in v2. Absent only on legacy v1 bundles. */
  kind?: 'selection-resource-bundle'
  /** Bundle format version. New exports always use v2. */
  version: 1 | 2
  /** When the bundle was created (Unix timestamp ms) */
  exportedAt: number
  /** Informational: name of the workspace this was exported from */
  sourceWorkspace?: string
  /** Informational Selection version that created the bundle. */
  sourceVersion?: string
  /** The exported resources */
  resources: {
    sources?: SourceBundleEntry[]
    skills?: SkillBundleEntry[]
    /** Per-automation entries (sanitized — webhook auth stripped) */
    automations?: AutomationBundleEntry[]
  }
  /** Portable resource inventory, dependency graph, and credential redactions (v2). */
  manifest?: ResourceBundleManifest
  /** SHA-256 of canonical bundle JSON with this field omitted (v2). */
  integrity?: ResourceBundleIntegrity
}

export type ResourceType = 'source' | 'skill' | 'automation'
export type ResourceDependencyType = ResourceType | 'label' | 'llm-connection' | 'model'

export interface ResourceRef {
  type: ResourceType
  id: string
}

export interface ResourceManifestItem extends ResourceRef {
  name?: string
  selected: boolean
  autoAdded?: boolean
}

export interface ResourceDependency {
  from: ResourceRef
  to: { type: ResourceDependencyType; id: string }
  reason: 'automation-mention' | 'skill-required-source' | 'label' | 'llm-connection' | 'model'
  /** External dependencies are intentionally not serialized as resources. */
  external?: boolean
}

export interface ResourceRedaction {
  resource: ResourceRef
  path: string
  reason: 'credential' | 'secret-header' | 'secret-env' | 'secret-url' | 'runtime-state'
  /** Safe identifier such as an environment-variable/header name. Never a value. */
  requiredName?: string
}

export interface ResourceBundleManifest {
  items: ResourceManifestItem[]
  dependencies: ResourceDependency[]
  redactions: ResourceRedaction[]
}

export interface ResourceBundleIntegrity {
  algorithm: 'sha256'
  digest: string
}

/**
 * A source in the bundle.
 * Config is sanitized (no secrets, no runtime state).
 * Files include everything in the source folder EXCEPT config.json.
 */
export interface SourceBundleEntry {
  /** Source slug (folder name) */
  slug: string
  /** Sanitized source config — no credentials, auth state reset */
  config: FolderSourceConfig
  /** All non-hidden regular files except config.json (guide.md, icons, permissions, docs, etc.) */
  files: BundleFile[]
}

/**
 * A skill in the bundle.
 * Files include everything in the skill folder (SKILL.md, icons, scripts, docs, etc.).
 * No separate metadata field — derive from SKILL.md at read time if needed.
 */
export interface SkillBundleEntry {
  /** Skill slug (folder name) */
  slug: string
  /** All non-hidden regular files in the skill directory */
  files: BundleFile[]
}

/**
 * An automation in the bundle.
 * Matcher config is sanitized (webhook auth stripped).
 */
export interface AutomationBundleEntry {
  /** Automation ID (6-char hex from automations.json) */
  id: string
  /** Display name (denormalized from matcher.name — metadata only, not used for identity) */
  name?: string
  /** Event type this automation is registered under */
  event: string
  /** The full matcher config (sanitized — webhook auth stripped) */
  matcher: AutomationMatcher
}

// ============================================================
// Import/Export Options & Results
// ============================================================

/**
 * Global import conflict mode for v1.
 * - 'skip': Keep existing resources, don't overwrite
 * - 'overwrite': Replace existing resources with imported ones
 */
export type ResourceImportMode = 'skip' | 'overwrite'
export type ResourceImportAction = ResourceImportMode | 'rename'

export interface ResourceImportDecision extends ResourceRef {
  action: ResourceImportAction
  /** Preview status observed by the client. Import rejects a changed target state. */
  expectedStatus?: ResourceImportPreviewStatus
  /** Hash of the conflicting target resource observed during preview. */
  expectedTargetFingerprint?: string
  /** Required for source/skill rename; optional generated ID override for automations. */
  newId?: string
  /** Optional display name override (primarily automations). */
  newName?: string
  /** Low-risk automations only. Defaults to false. */
  enableAfterImport?: boolean
}

export interface ResourceImportPlan {
  decisions: ResourceImportDecision[]
}

export type ResourceImportPreviewStatus = 'new' | 'identity-conflict' | 'name-conflict'

export interface ResourceImportPreviewItem extends ResourceRef {
  name?: string
  status: ResourceImportPreviewStatus
  /** Hash of the current conflict target, used to detect edits after preview. */
  targetFingerprint?: string
  suggestedId?: string
  needsConfiguration: boolean
  highRisk: boolean
  missingDependencies: Array<{ type: ResourceDependencyType; id: string }>
  warnings: string[]
}

export interface ResourceImportPreview {
  valid: boolean
  version: 1 | 2 | null
  integrityVerified: boolean
  errors: string[]
  warnings: string[]
  items: ResourceImportPreviewItem[]
}

/**
 * Options for resource export.
 */
export interface ExportResourcesOptions {
  /** Source slugs to export, or 'all' for every source */
  sources?: string[] | 'all'
  /** Skill slugs to export, or 'all' for every skill */
  skills?: string[] | 'all'
  /** Automation IDs/names to export, 'all' for every automation, or true (= 'all') */
  automations?: boolean | string[] | 'all'
  /** Include workspace source/skill dependencies referenced by selected resources. Default true. */
  includeDependencies?: boolean
  /** Informational application version written into a v2 bundle. */
  sourceVersion?: string
}

/**
 * Options for local copy between workspaces (filesystem + optional credentials).
 */
export interface CopyResourcesOptions {
  /** Source slugs to copy, or 'all' */
  sources?: string[] | 'all'
  /** Skill slugs to copy, or 'all' */
  skills?: string[] | 'all'
  /** Conflict mode when target already has the slug */
  mode?: ResourceImportMode
  /**
   * Copy credential-store secrets for sources (default true).
   * Only applies to local→local transfers.
   */
  includeCredentials?: boolean
}

/**
 * Result of a resource export.
 */
export interface ExportResult {
  bundle: ResourceBundle
  /** Export-time warnings (skipped resources, stripped secrets, non-portable paths, etc.) */
  warnings: string[]
}

/**
 * Per-resource-type import result with room for partial failures.
 */
export interface ImportBucketResult {
  /** Identifiers that were successfully imported (slugs for sources/skills, IDs for automations) */
  imported: string[]
  /** Identifiers that were skipped (already exist + mode='skip') */
  skipped: string[]
  /** Identifiers that failed with an error */
  failed: Array<{ id: string; error: string }>
  /** Warnings (non-fatal issues) */
  warnings: string[]
}

/**
 * Result of a resource import.
 */
export interface ResourceImportResult {
  sources: ImportBucketResult
  skills: ImportBucketResult
  automations: ImportBucketResult
}

// ============================================================
// Dependency injection for import
// ============================================================

/**
 * Dependencies injected into importResources for credential cleanup.
 * This avoids the resource module depending on the credential store directly.
 */
export interface ResourceImportDeps {
  /**
   * Clear all stored credentials for a source slug in a workspace.
   * Called on source overwrite to prevent stale credential leakage.
   */
  clearSourceCredentials: (workspaceId: string, sourceSlug: string) => Promise<void>
}
