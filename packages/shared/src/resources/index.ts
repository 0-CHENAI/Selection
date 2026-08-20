/**
 * Resource Bundle — Workspace resource export/import
 */

export type {
  ResourceBundle,
  SourceBundleEntry,
  SkillBundleEntry,
  AutomationBundleEntry,
  ResourceImportMode,
  ExportResourcesOptions,
  CopyResourcesOptions,
  ExportResult,
  ImportBucketResult,
  ResourceImportResult,
  ResourceImportDeps,
} from './types.ts'

export {
  exportResources,
  importResources,
  validateResourceBundle,
} from './resource-bundle.ts'

export type {
  CopyBetweenWorkspacesOptions,
  CopyBetweenWorkspacesDeps,
} from './copy-between-workspaces.ts'

export {
  copyBetweenWorkspaces,
  credentialWorkspaceIdFromRoot,
  isSafeResourceSlug,
} from './copy-between-workspaces.ts'

export {
  WORKSPACE_BUNDLE_KIND,
  exportWorkspace,
  importWorkspace,
  readWorkspaceBundleFile,
  summarizeWorkspaceBundle,
  validateWorkspaceBundle,
} from './workspace-bundle.ts'

export type {
  WorkspaceBundle,
  WorkspaceSessionEntry,
  ExportWorkspaceOptions,
  ImportWorkspaceOptions,
  WorkspaceImportResult,
} from './workspace-bundle.ts'
