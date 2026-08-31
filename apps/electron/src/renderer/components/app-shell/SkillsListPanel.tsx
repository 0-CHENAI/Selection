import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { toast } from 'sonner'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { CopyResourcesFromWorkspaceDialog } from './CopyResourcesFromWorkspaceDialog'
import { ResourceTransferDialog } from '@/components/resources/ResourceTransferDialog'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { useDisplayTitleRename } from '@/hooks/useDisplayTitleRename'
import { resolveSkillTitle } from '@craft-agent/shared/display-titles'
import type { LoadedSkill } from '../../../shared/types'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workspaceRootPath?: string
  /** Session working directory — needed to rename project-level skills */
  workingDirectory?: string
  className?: string
  /** Controlled open state for copy-from-workspace dialog (header button) */
  copyFromOpen?: boolean
  onCopyFromOpenChange?: (open: boolean) => void
  onImportFromFile?: React.MouseEventHandler<HTMLButtonElement>
}

export function SkillsListPanel({
  skills,
  onDeleteSkill,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  workingDirectory,
  className,
  copyFromOpen: copyFromOpenProp,
  onCopyFromOpenChange,
  onImportFromFile,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1
  const hasOtherLocalWorkspaces = workspaces.some(
    (w) => w.id !== activeWorkspaceId && !w.remoteServer,
  )

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')
  const [copyFromOpenInternal, setCopyFromOpenInternal] = React.useState(false)
  const [exportResourceSlug, setExportResourceSlug] = React.useState<string | null>(null)
  const copyFromOpen = copyFromOpenProp ?? copyFromOpenInternal
  const setCopyFromOpen = onCopyFromOpenChange ?? setCopyFromOpenInternal
  const rename = useDisplayTitleRename('skill', workspaceId ?? activeWorkspaceId, workingDirectory)

  return (
    <>
    <EntityPanel<LoadedSkill>
      items={skills}
      getId={(s) => s.slug}
      selection={skillSelection}
      selectedId={selectedSkillSlug}
      onItemClick={onSkillClick}
      className={className}
      containerProps={{ 'data-list-role': 'skills' }}
      emptyState={
        <EntityListEmptyScreen
          icon={<Zap />}
          title={t('skillsList.noSkillsConfigured')}
          description={t('skillsList.emptyDescription')}
          docKey="skills"
        >
          <div className="flex flex-wrap items-center justify-center gap-2">
            {workspaceRootPath && (
              <EditPopover
                align="center"
                trigger={
                  <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                    {t('skillsList.addSkill')}
                  </button>
                }
                {...getEditConfig('add-skill', workspaceRootPath)}
              />
            )}
            {onImportFromFile && (
              <button
                type="button"
                onClick={onImportFromFile}
                className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
              >
                {t('fileImport.skillTitle')}
              </button>
            )}
            {hasOtherLocalWorkspaces && (
              <button
                type="button"
                onClick={() => setCopyFromOpen(true)}
                className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
              >
                {t('skillsList.copyFromWorkspace')}
              </button>
            )}
          </div>
        </EntityListEmptyScreen>
      }
      mapItem={(skill) => {
        const title = resolveSkillTitle(skill)
        return {
          icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
          title,
          badges: (
            <span className="flex items-center gap-1.5 min-w-0">
              {skill.source === 'project' && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground">
                  {t('skillsList.projectBadge')}
                </span>
              )}
              {skill.source === 'bundled' && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground">
                  {t('skillsList.bundledBadge')}
                </span>
              )}
              <span className="truncate">{skill.metadata.description}</span>
            </span>
          ),
          menu: (
            <SkillMenu
              skillSlug={skill.slug}
              skillName={title}
              onRename={() => rename.start(skill.slug, {
                displayTitle: skill.displayTitle,
                defaultTitle: skill.metadata.name,
              })}
              onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://skills/skill/${skill.slug}?window=focused`)}
              onShowInFinder={async () => {
                if (!canRevealLocally) return
                try {
                  await window.electronAPI.showInFolder(skill.path)
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err)
                  toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
                    description: message,
                  })
                }
              }}
              canShowInFinder={canRevealLocally}
              onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
              canDelete={skill.source === 'workspace'}
              deleteLabel={skill.source === 'workspace'
                ? t('skillsList.deleteSkill')
                : skill.source === 'bundled'
                  ? t('skillsList.managedByApp')
                  : t('skillsList.managedByProject')}
              onSendToWorkspace={hasOtherWorkspaces && skill.source === 'workspace' ? () => {
                setSendResourceSlug(skill.slug)
                setSendResourceLabel(title)
                setSendDialogOpen(true)
              } : undefined}
              onExport={skill.source === 'workspace' ? () => setExportResourceSlug(skill.slug) : undefined}
            />
          ),
        }
      }}
    />

    {/* Send to Workspace dialog */}
    {sendResourceSlug && (
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType="skill"
        resourceIds={[sendResourceSlug]}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />
    )}

    <CopyResourcesFromWorkspaceDialog
      open={copyFromOpen}
      onOpenChange={setCopyFromOpen}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      resourceType="skill"
    />
    {exportResourceSlug && activeWorkspaceId && (
      <ResourceTransferDialog
        open
        mode="export"
        workspaceId={activeWorkspaceId}
        initialSelection={[{ type: 'skill', id: exportResourceSlug }]}
        onOpenChange={(isOpen) => { if (!isOpen) setExportResourceSlug(null) }}
      />
    )}
    {rename.dialog}
    </>
  )
}
