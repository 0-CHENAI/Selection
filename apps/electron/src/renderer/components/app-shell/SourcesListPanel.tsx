import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseZap } from 'lucide-react'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { sourceSelection } from '@/hooks/useEntitySelection'
import { SourceMenu } from './SourceMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { CopyResourcesFromWorkspaceDialog } from './CopyResourcesFromWorkspaceDialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig, type EditContextKey } from '@/components/ui/EditPopover'
import { useDisplayTitleRename } from '@/hooks/useDisplayTitleRename'
import { resolveSourceTitle } from '@craft-agent/shared/display-titles'
import type { LoadedSource, SourceConnectionStatus, SourceFilter } from '../../../shared/types'

const SOURCE_TYPE_CONFIG: Record<string, { labelKey: string; colorClass: string }> = {
  mcp: { labelKey: 'sourcesList.typeMcp', colorClass: 'bg-accent/10 text-accent' },
  api: { labelKey: 'sourcesList.typeApi', colorClass: 'bg-success/10 text-success' },
  local: { labelKey: 'sourcesList.typeLocal', colorClass: 'bg-info/10 text-info' },
}

const SOURCE_STATUS_CONFIG: Record<string, { labelKey: string; colorClass: string } | null> = {
  connected: null,
  needs_auth: { labelKey: 'sourcesList.statusAuthRequired', colorClass: 'bg-warning/10 text-warning' },
  failed: { labelKey: 'sourcesList.statusDisconnected', colorClass: 'bg-destructive/10 text-destructive' },
  untested: { labelKey: 'sourcesList.statusNotTested', colorClass: 'bg-foreground/10 text-foreground/50' },
  local_disabled: { labelKey: 'sourcesList.statusDisabled', colorClass: 'bg-foreground/10 text-foreground/50' },
}

const SOURCE_TYPE_FILTER_LABEL_KEYS: Record<string, string> = {
  api: 'sourcesList.filterApi',
  mcp: 'sourcesList.filterMcp',
  local: 'sourcesList.filterLocalFolder',
}

export interface SourcesListPanelProps {
  sources: LoadedSource[]
  sourceFilter?: SourceFilter | null
  workspaceRootPath?: string
  onDeleteSource: (sourceSlug: string) => void
  onSourceClick: (source: LoadedSource) => void
  selectedSourceSlug?: string | null
  localMcpEnabled?: boolean
  className?: string
  /** Controlled open state for copy-from-workspace dialog (header button) */
  copyFromOpen?: boolean
  onCopyFromOpenChange?: (open: boolean) => void
}

export function SourcesListPanel({
  sources,
  sourceFilter,
  workspaceRootPath,
  onDeleteSource,
  onSourceClick,
  selectedSourceSlug,
  localMcpEnabled = true,
  className,
  copyFromOpen: copyFromOpenProp,
  onCopyFromOpenChange,
}: SourcesListPanelProps) {
  const { t } = useTranslation()
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
  const copyFromOpen = copyFromOpenProp ?? copyFromOpenInternal
  const setCopyFromOpen = onCopyFromOpenChange ?? setCopyFromOpenInternal
  const rename = useDisplayTitleRename('source', activeWorkspaceId)

  const filteredSources = React.useMemo(() => {
    if (!sourceFilter) return sources
    return sources.filter(s => s.config.type === sourceFilter.sourceType)
  }, [sources, sourceFilter])

  const emptyMessage = React.useMemo(() => {
    if (sourceFilter?.kind === 'type') {
      const filterLabelKey = SOURCE_TYPE_FILTER_LABEL_KEYS[sourceFilter.sourceType]
      const filterLabel = filterLabelKey ? t(filterLabelKey) : sourceFilter.sourceType
      return t('sourcesList.noSourcesOfType', { type: filterLabel })
    }
    return t('sourcesList.noSourcesConfigured')
  }, [sourceFilter, t])

  return (
    <>
    <EntityPanel<LoadedSource>
      items={filteredSources}
      getId={(s) => s.config.slug}
      selection={sourceSelection}
      selectedId={selectedSourceSlug}
      onItemClick={onSourceClick}
      className={className}
      containerProps={{ 'data-list-role': 'sources' }}
      emptyState={
        <EntityListEmptyScreen
          icon={<DatabaseZap />}
          title={emptyMessage}
          description={t('sourcesList.emptyDescription')}
          docKey="sources"
        >
          <div className="flex flex-wrap items-center justify-center gap-2">
            {workspaceRootPath && (
              <EditPopover
                align="center"
                trigger={
                  <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                    {t('sourcesList.addSource')}
                  </button>
                }
                {...getEditConfig(
                  sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                  workspaceRootPath
                )}
              />
            )}
            {hasOtherLocalWorkspaces && (
              <button
                type="button"
                onClick={() => setCopyFromOpen(true)}
                className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
              >
                {t('sourcesList.copyFromWorkspace')}
              </button>
            )}
          </div>
        </EntityListEmptyScreen>
      }
      mapItem={(source) => {
        const connectionStatus = deriveConnectionStatus(source, localMcpEnabled)
        const typeConfig = SOURCE_TYPE_CONFIG[source.config.type]
        const statusConfig = SOURCE_STATUS_CONFIG[connectionStatus]
        const subtitle = source.config.tagline || source.config.provider || ''
        const title = resolveSourceTitle(source)
        return {
          icon: <SourceAvatar source={source} size="sm" />,
          title,
          badges: (
            <>
              {typeConfig && <EntityListBadge colorClass={typeConfig.colorClass}>{t(typeConfig.labelKey)}</EntityListBadge>}
              {statusConfig && (
                <EntityListBadge colorClass={statusConfig.colorClass} tooltip={source.config.connectionError || undefined} className="cursor-default">
                  {t(statusConfig.labelKey)}
                </EntityListBadge>
              )}
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{source.config.slug}</span>
              {subtitle && <span className="truncate">{subtitle}</span>}
            </>
          ),
          menu: (
            <SourceMenu
              sourceSlug={source.config.slug}
              sourceName={title}
              onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://sources/source/${source.config.slug}?window=focused`)}
              onShowInFinder={() => window.electronAPI.showInFolder(source.folderPath)}
              onRename={() => rename.start(source.config.slug, {
                displayTitle: source.displayTitle,
                defaultTitle: source.config.name,
              })}
              onDelete={() => onDeleteSource(source.config.slug)}
              onSendToWorkspace={hasOtherWorkspaces ? () => {
                setSendResourceSlug(source.config.slug)
                setSendResourceLabel(title)
                setSendDialogOpen(true)
              } : undefined}
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
        resourceType="source"
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
      resourceType="source"
    />
    {rename.dialog}
    </>
  )
}
