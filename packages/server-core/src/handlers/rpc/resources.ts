/**
 * Resources RPC Handlers
 *
 * Handles workspace resource export/import/copy (sources, skills, automations).
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getCredentialManager, SOURCE_CREDENTIAL_TYPES } from '@craft-agent/shared/credentials'
import { resolveFsPath } from '@craft-agent/shared/utils'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  activateImportedMcpSources,
  createMcpValidationDependencies,
  extractMcpImportCredentials,
} from './mcp-import-credentials'
import type {
  ResourceBundle,
  ResourceImportMode,
  ResourceImportPlan,
  ExportResourcesOptions,
  CopyResourcesOptions,
  ResourceImportResult,
  ResourceImportPreview,
  McpImportCandidate,
  McpImportDecision,
  SkillImportDecision,
} from '@craft-agent/shared/resources'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.resources.EXPORT,
  RPC_CHANNELS.resources.PREVIEW_IMPORT,
  RPC_CHANNELS.resources.IMPORT,
  RPC_CHANNELS.resources.PREVIEW_MCP_JSON,
  RPC_CHANNELS.resources.IMPORT_MCP_JSON,
  RPC_CHANNELS.resources.PREVIEW_SKILL_FILE,
  RPC_CHANNELS.resources.IMPORT_SKILL_FILE,
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
      // NFC-resolve so Chinese folder paths are stable across picker / FS forms
      const result = exportResources(resolveFsPath(workspace.rootPath), {
        ...options,
        sourceVersion: options.sourceVersion ?? deps.platform.appVersion,
      })

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

  server.handle(
    RPC_CHANNELS.resources.PREVIEW_IMPORT,
    async (_ctx, workspaceId: string, bundle: ResourceBundle): Promise<ResourceImportPreview> => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const { previewResourceImport } = await import('@craft-agent/shared/resources')
      return previewResourceImport(resolveFsPath(workspace.rootPath), bundle)
    },
  )

  server.handle(
    RPC_CHANNELS.resources.PREVIEW_MCP_JSON,
    async (_ctx, workspaceId: string, jsonText: string): Promise<McpImportCandidate[]> => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const { parseMcpImportJson } = await import('@craft-agent/shared/resources')
      return parseMcpImportJson(jsonText, resolveFsPath(workspace.rootPath))
    },
  )

  server.handle(
    RPC_CHANNELS.resources.IMPORT_MCP_JSON,
    async (
      _ctx,
      workspaceId: string,
      input: McpImportCandidate[] | string,
      requestedDecisions?: McpImportDecision[],
    ) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const workspaceRootPath = resolveFsPath(workspace.rootPath)
      const { importMcpCandidates, parseMcpImportJson } = await import('@craft-agent/shared/resources')
      const candidates = typeof input === 'string'
        ? parseMcpImportJson(input, workspaceRootPath)
        : input
      const decisions = requestedDecisions ?? candidates.map(candidate => ({
        key: candidate.key,
        action: candidate.conflict ? 'skip' as const : 'overwrite' as const,
      }))
      const credentials = typeof input === 'string'
        ? extractMcpImportCredentials(input, candidates)
        : new Map<string, string>()
      const result = await importMcpCandidates(workspaceRootPath, candidates, decisions)

      const pendingValidations = activateImportedMcpSources(
        workspaceRootPath,
        candidates,
        decisions,
        result.imported,
        credentials,
        createMcpValidationDependencies(deps),
      )

      for (const validation of pendingValidations) {
        void validation.catch(error => {
          deps.platform.logger?.error('Background MCP connection validation failed:', error)
        })
      }

      for (const slug of result.imported) {
        deps.sessionManager.notifyConfigFileChange(workspaceRootPath, `sources/${slug}/config.json`)
      }
      return result
    },
  )

  server.handle(
    RPC_CHANNELS.resources.PREVIEW_SKILL_FILE,
    async (_ctx, workspaceId: string, payload: { kind: 'markdown'; content: string } | { kind: 'zip'; zipBase64: string }) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const root = resolveFsPath(workspace.rootPath)
      const { previewSkillMarkdown, previewSkillZip } = await import('@craft-agent/shared/resources')
      if (payload.kind === 'markdown') return previewSkillMarkdown(payload.content, root)
      return previewSkillZip(Buffer.from(payload.zipBase64, 'base64'), root).preview
    },
  )

  server.handle(
    RPC_CHANNELS.resources.IMPORT_SKILL_FILE,
    async (
      _ctx,
      workspaceId: string,
      payload: { kind: 'markdown'; content: string } | { kind: 'zip'; zipBase64: string },
      decision: SkillImportDecision,
    ) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const root = resolveFsPath(workspace.rootPath)
      const { importSkillMarkdown, importSkillZip } = await import('@craft-agent/shared/resources')
      const result = payload.kind === 'markdown'
        ? importSkillMarkdown(root, payload.content, decision)
        : importSkillZip(root, Buffer.from(payload.zipBase64, 'base64'), decision)
      if (!result.skipped) {
        deps.sessionManager.notifyConfigFileChange(root, `skills/${result.slug}/SKILL.md`)
      }
      return result
    },
  )

  // Import a resource bundle into a workspace
  server.handle(
    RPC_CHANNELS.resources.IMPORT,
    async (
      _ctx,
      workspaceId: string,
      bundle: ResourceBundle,
      modeOrPlan: ResourceImportMode | ResourceImportPlan,
    ) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const { importResources } = await import('@craft-agent/shared/resources')
      const credDeps = makeCredentialDeps()

      const targetRoot = resolveFsPath(workspace.rootPath)
      const result = await importResources(targetRoot, bundle, modeOrPlan, {
        clearSourceCredentials: credDeps.clearSourceCredentials,
      })

      deps.platform.logger?.info(
        `RESOURCES_IMPORT: Imported into ${workspaceId} (mode=${typeof modeOrPlan === 'string' ? modeOrPlan : 'plan'}): ` +
        `sources=${result.sources.imported.length} imported, ${result.sources.skipped.length} skipped, ${result.sources.failed.length} failed; ` +
        `skills=${result.skills.imported.length} imported, ${result.skills.skipped.length} skipped, ${result.skills.failed.length} failed; ` +
        `automations=${result.automations.imported.length} imported, ${result.automations.skipped.length} skipped, ${result.automations.failed.length} failed`,
      )

      // Notify ConfigWatcher of imported files so UI refreshes on Linux
      // (Bun's fs.watch doesn't reliably detect atomic renames)
      notifyResourceImport(
        deps,
        targetRoot,
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

      // Resolve + NFC before compare/copy so Chinese path segments match
      const fromRoot = resolveFsPath(fromWorkspace.rootPath)
      const toRoot = resolveFsPath(toWorkspace.rootPath)

      if (fromRoot === toRoot) {
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
          fromRootPath: fromRoot,
          toRootPath: toRoot,
          fromCredentialWorkspaceId: credentialWorkspaceIdFromRoot(fromRoot),
          toCredentialWorkspaceId: credentialWorkspaceIdFromRoot(toRoot),
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

      notifyResourceImport(deps, toRoot, result)
      return result
    },
  )
}
