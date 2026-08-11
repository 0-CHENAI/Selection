/**
 * Resources RPC Handlers
 *
 * Handles workspace resource export/import/copy (sources, skills, automations).
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getCredentialManager, SOURCE_CREDENTIAL_TYPES } from '@craft-agent/shared/credentials'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type {
  ResourceBundle,
  ResourceImportMode,
  ExportResourcesOptions,
  CopyResourcesOptions,
  ResourceImportResult,
} from '@craft-agent/shared/resources'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.resources.EXPORT,
  RPC_CHANNELS.resources.IMPORT,
  RPC_CHANNELS.resources.COPY_BETWEEN,
] as const

function makeCredentialDeps() {
  const credManager = getCredentialManager()
  return {
    clearSourceCredentials: async (wsId: string, sourceSlug: string) => {
      for (const credType of SOURCE_CREDENTIAL_TYPES) {
        try {
          await credManager.delete({
            type: credType,
            workspaceId: wsId,
            sourceId: sourceSlug,
          })
        } catch {
          // Ignore missing credential types
        }
      }
    },
    copySourceCredentials: async (fromWs: string, toWs: string, sourceSlug: string) => {
      let copied = false
      for (const credType of SOURCE_CREDENTIAL_TYPES) {
        try {
          const cred = await credManager.get({
            type: credType,
            workspaceId: fromWs,
            sourceId: sourceSlug,
          })
          if (cred) {
            await credManager.set(
              { type: credType, workspaceId: toWs, sourceId: sourceSlug },
              cred,
            )
            copied = true
          }
        } catch {
          // Ignore per-type errors
        }
      }
      return copied
    },
  }
}

function notifyResourceImport(
  deps: HandlerDeps,
  workspaceRootPath: string,
  result: ResourceImportResult,
  automationsTouched = false,
) {
  if (automationsTouched || result.automations.imported.length > 0) {
    deps.sessionManager.notifyConfigFileChange(workspaceRootPath, 'automations.json')
  }
  for (const slug of result.sources.imported) {
    deps.sessionManager.notifyConfigFileChange(workspaceRootPath, `sources/${slug}/config.json`)
  }
  for (const slug of result.skills.imported) {
    deps.sessionManager.notifyConfigFileChange(workspaceRootPath, `skills/${slug}/SKILL.md`)
  }
}

export function registerResourcesHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Export workspace resources to a portable bundle
  server.handle(
    RPC_CHANNELS.resources.EXPORT,
    async (_ctx, workspaceId: string, options: ExportResourcesOptions) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const { exportResources } = await import('@craft-agent/shared/resources')
      const result = exportResources(workspace.rootPath, options)

      deps.platform.logger?.info(
        `RESOURCES_EXPORT: Exported from ${workspaceId}: ` +
        `${result.bundle.resources.sources?.length ?? 0} sources, ` +
        `${result.bundle.resources.skills?.length ?? 0} skills, ` +
        `${result.bundle.resources.automations?.length ?? 0} automations` +
        (result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : ''),
      )

      return result
    },
  )

  // Import a resource bundle into a workspace
  server.handle(
    RPC_CHANNELS.resources.IMPORT,
    async (_ctx, workspaceId: string, bundle: ResourceBundle, mode: ResourceImportMode) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const { importResources } = await import('@craft-agent/shared/resources')
      const credDeps = makeCredentialDeps()

      const result = await importResources(workspace.rootPath, bundle, mode, {
        clearSourceCredentials: credDeps.clearSourceCredentials,
      })

      deps.platform.logger?.info(
        `RESOURCES_IMPORT: Imported into ${workspaceId} (mode=${mode}): ` +
        `sources=${result.sources.imported.length} imported, ${result.sources.skipped.length} skipped, ${result.sources.failed.length} failed; ` +
        `skills=${result.skills.imported.length} imported, ${result.skills.skipped.length} skipped, ${result.skills.failed.length} failed; ` +
        `automations=${result.automations.imported.length} imported, ${result.automations.skipped.length} skipped, ${result.automations.failed.length} failed`,
      )

      // Notify ConfigWatcher of imported files so UI refreshes on Linux
      // (Bun's fs.watch doesn't reliably detect atomic renames)
      notifyResourceImport(
        deps,
        workspace.rootPath,
        result,
        Boolean(bundle.resources.automations?.length),
      )

      return result
    },
  )

  // Local filesystem copy between workspaces (includes credentials by default)
  server.handle(
    RPC_CHANNELS.resources.COPY_BETWEEN,
    async (
      _ctx,
      fromWorkspaceId: string,
      toWorkspaceId: string,
      options: CopyResourcesOptions = {},
    ) => {
      const fromWorkspace = getWorkspaceByNameOrId(fromWorkspaceId)
      if (!fromWorkspace) throw new Error(`Source workspace not found: ${fromWorkspaceId}`)
      const toWorkspace = getWorkspaceByNameOrId(toWorkspaceId)
      if (!toWorkspace) throw new Error(`Target workspace not found: ${toWorkspaceId}`)

      if (fromWorkspace.remoteServer || toWorkspace.remoteServer) {
        throw new Error('Local credential copy only works between local workspaces. Use export/import for remote targets.')
      }

      if (fromWorkspace.rootPath === toWorkspace.rootPath) {
        throw new Error('Cannot copy a workspace onto itself')
      }

      const hasSources = options.sources === 'all' || (Array.isArray(options.sources) && options.sources.length > 0)
      const hasSkills = options.skills === 'all' || (Array.isArray(options.skills) && options.skills.length > 0)
      if (!hasSources && !hasSkills) {
        throw new Error('Nothing to copy: specify sources and/or skills')
      }

      const {
        copyBetweenWorkspaces,
        credentialWorkspaceIdFromRoot,
      } = await import('@craft-agent/shared/resources')

      const credDeps = makeCredentialDeps()
      const mode: ResourceImportMode = options.mode ?? 'skip'
      const includeCredentials = options.includeCredentials !== false

      const result = await copyBetweenWorkspaces(
        {
          fromRootPath: fromWorkspace.rootPath,
          toRootPath: toWorkspace.rootPath,
          fromCredentialWorkspaceId: credentialWorkspaceIdFromRoot(fromWorkspace.rootPath),
          toCredentialWorkspaceId: credentialWorkspaceIdFromRoot(toWorkspace.rootPath),
          sources: options.sources,
          skills: options.skills,
          mode,
          includeCredentials,
        },
        credDeps,
      )

      deps.platform.logger?.info(
        `RESOURCES_COPY: ${fromWorkspaceId} → ${toWorkspaceId} ` +
        `(mode=${mode}, credentials=${includeCredentials}): ` +
        `sources=${result.sources.imported.length} imported, ${result.sources.skipped.length} skipped, ${result.sources.failed.length} failed; ` +
        `skills=${result.skills.imported.length} imported, ${result.skills.skipped.length} skipped, ${result.skills.failed.length} failed`,
      )

      notifyResourceImport(deps, toWorkspace.rootPath, result)
      return result
    },
  )
}
