import { join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { setDisplayTitle } from '@craft-agent/shared/display-titles/storage'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { getPptCatalogWithLibrary, getPptTemplatePages } from '../../services/ppt-catalog'
import { isPptGenerating, readPptLive } from '../../services/ppt-live'
import { customTemplateCard, customTemplatePages, deletePptTemplate, exportPptTemplate, importPptTemplate, renamePptTemplate } from '../../services/ppt-library'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.DELETE_PPT_TEMPLATE,
  RPC_CHANNELS.skills.EXPORT_PPT_TEMPLATE,
  RPC_CHANNELS.skills.GET_PPT_CATALOG,
  RPC_CHANNELS.skills.GET_PPT_LIVE,
  RPC_CHANNELS.skills.GET_PPT_TEMPLATE_PAGES,
  RPC_CHANNELS.skills.IMPORT_PPT_TEMPLATE,
  RPC_CHANNELS.skills.RENAME_PPT_TEMPLATE,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
  RPC_CHANNELS.skills.SET_DISPLAY_TITLE,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.skills.GET_PPT_CATALOG, () => getPptCatalogWithLibrary())
  server.handle(RPC_CHANNELS.skills.GET_PPT_TEMPLATE_PAGES, (_ctx, templateId: string) => {
    if (typeof templateId !== 'string') throw new Error('Unknown PPT template')
    return templateId.startsWith('custom-') ? customTemplatePages(templateId) : getPptTemplatePages(templateId)
  })
  server.handle(RPC_CHANNELS.skills.IMPORT_PPT_TEMPLATE, (_ctx, input: { name?: string; base64?: string }) => {
    if (!input || typeof input.name !== 'string' || input.name.length === 0 || input.name.length > 255 || typeof input.base64 !== 'string') throw new Error('Invalid PPTX')
    if (input.base64.length === 0 || input.base64.length > 12_000_000 || input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw new Error('Invalid PPTX')
    const { record, duplicate } = importPptTemplate(new Uint8Array(Buffer.from(input.base64, 'base64')), input.name)
    return { template: customTemplateCard(record), duplicate }
  })
  server.handle(RPC_CHANNELS.skills.RENAME_PPT_TEMPLATE, (_ctx, id: string, title: string) => customTemplateCard(renamePptTemplate(id, title)))
  server.handle(RPC_CHANNELS.skills.DELETE_PPT_TEMPLATE, (_ctx, id: string) => { deletePptTemplate(id) })
  server.handle(RPC_CHANNELS.skills.EXPORT_PPT_TEMPLATE, (_ctx, id: string) => {
    const file = exportPptTemplate(id)
    return { name: file.name, base64: Buffer.from(file.bytes).toString('base64') }
  })
  server.handle(RPC_CHANNELS.skills.GET_PPT_LIVE, async (_ctx, sessionId: string, known?: Record<string, string>) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Session not found')
    const dir = deps.sessionManager.getSessionPath(sessionId)
    if (!dir) throw new Error('Session not found')
    return readPptLive(dir, { generating: isPptGenerating(dir), known, sessionId })
  })
  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    // Validate workingDirectory exists on this server — a thin client may pass
    // its local path which doesn't exist on the remote server's filesystem.
    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { filterUserFacingSkills, loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = filterUserFacingSkills(loadAllSkills(workspace.rootPath, effectiveWorkingDir))
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Delete a skill from a workspace
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill, loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const existing = loadSkillBySlug(workspace.rootPath, skillSlug)
    if (existing?.source === 'bundled') {
      throw new Error('Cannot delete a built-in skill')
    }
    deleteSkill(workspace.rootPath, skillSlug)
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  server.handle(RPC_CHANNELS.skills.SET_DISPLAY_TITLE, async (_ctx, workspaceId: string, skillSlug: string, title: string, workingDirectory?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { filterUserFacingSkills, loadAllSkills, loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const existing = loadSkillBySlug(workspace.rootPath, skillSlug, effectiveWorkingDir)
    if (!existing) throw new Error('Skill not found')
    const displayTitle = setDisplayTitle(workspace.rootPath, 'skills', skillSlug, title, existing.metadata.name)
    const skills = filterUserFacingSkills(loadAllSkills(workspace.rootPath, effectiveWorkingDir))
    pushTyped(server, RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId, skills)
    return { displayTitle }
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await deps.platform.showItemInFolder?.(skillDir)
  })
}
