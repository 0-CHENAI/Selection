import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { navigate, routes } from '@/lib/navigate'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import {
  getModelDisplayName,
  getModelShortName,
} from '@config/models'
import {
  resolveEffectiveConnectionSlug,
} from '@config/llm-connections'
import {
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@craft-agent/shared/agent/thinking-levels'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'
import { derivePickerMode } from './picker-mode'
import {
  connectionPinnedModelIds,
  formatTokenCount,
  groupConnectionsByProvider,
  isOpenRouterConnection,
  isPickerModelSelected,
  pickerModelId,
  resolvePickerModelsWithLive,
  resolveVisiblePickerModels,
  stripPiPrefixForDisplay,
} from './model-picker-helpers'
import { useLiveOpenRouterModels } from '@/hooks/useLiveOpenRouterModels'
import {
  ModelPickerEmptyResults,
  ModelPickerOverflowHint,
  ModelPickerSearchField,
  shouldShowPickerSearch,
  usePickerSearchQuery,
  useVisiblePickerModels,
} from './ModelPickerSearch'

function CompactSwitcherModels({
  conn,
  liveOpenRouterModels,
  currentModel,
  isCurrentConnection,
  onPick,
}: {
  conn: Parameters<typeof resolvePickerModelsWithLive>[0] & { slug: string }
  liveOpenRouterModels: Parameters<typeof resolvePickerModelsWithLive>[1]
  currentModel: string
  isCurrentConnection: boolean
  onPick: (connectionSlug: string, modelId: string) => void
}) {
  const [query, setQuery] = React.useState('')
  const models = resolvePickerModelsWithLive(conn, liveOpenRouterModels)
  const visibleCatalog = resolveVisiblePickerModels(models, {
    query,
    currentModel: isCurrentConnection ? currentModel : conn.defaultModel,
    pinnedIds: connectionPinnedModelIds(conn),
  })
  const showSearch = shouldShowPickerSearch(models.length, query)

  return (
    <div className="pl-6 flex flex-col gap-0.5">
      {showSearch && (
        <ModelPickerSearchField value={query} onChange={setQuery} className="px-1" />
      )}
      {visibleCatalog.visible.length === 0 ? (
        <ModelPickerEmptyResults />
      ) : (
        visibleCatalog.visible.map(model => {
          const modelId = pickerModelId(model)
          const modelName = typeof model === 'string'
            ? stripPiPrefixForDisplay(getModelShortName(model))
            : (model.name ?? stripPiPrefixForDisplay(model.id))
          const isSelectedModel =
            isCurrentConnection && isPickerModelSelected(currentModel, modelId)
          return (
            <DrawerClose asChild key={modelId}>
              <button
                type="button"
                onClick={() => onPick(conn.slug, modelId)}
                className={cn(
                  'flex items-center justify-between w-full px-3 py-2 rounded-lg text-left transition-colors',
                  isSelectedModel
                    ? 'bg-foreground/5'
                    : 'hover:bg-foreground/5',
                )}
              >
                <span className="text-sm font-medium truncate">{modelName}</span>
                {isSelectedModel && (
                  <Check className="h-3 w-3 text-foreground/60 ml-3 shrink-0" />
                )}
              </button>
            </DrawerClose>
          )
        })
      )}
      <ModelPickerOverflowHint
        hiddenCount={visibleCatalog.hiddenCount}
        searching={query.trim().length > 0}
      />
    </div>
  )
}

interface CompactModelSelectorProps {
  currentModel: string
  currentConnection?: string
  onModelChange: (model: string, connection?: string) => void
  onConnectionChange?: (connectionSlug: string) => void
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  isEmptySession?: boolean
  connectionUnavailable?: boolean
  contextStatus?: {
    isCompacting?: boolean
    inputTokens?: number
    contextWindow?: number
  }
}

export function CompactModelSelector({
  currentModel,
  currentConnection,
  onModelChange,
  onConnectionChange,
  thinkingLevel = 'medium',
  onThinkingLevelChange,
  connectionUnavailable = false,
  contextStatus,
}: CompactModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [expandedConnection, setExpandedConnection] = React.useState<string | null>(null)

  const appShellCtx = useOptionalAppShellContext()
  const llmConnections = appShellCtx?.llmConnections ?? []
  const workspaceDefaultConnection = appShellCtx?.workspaceDefaultLlmConnection

  const effectiveConnection = resolveEffectiveConnectionSlug(
    currentConnection,
    workspaceDefaultConnection,
    llmConnections,
  )

  const effectiveConnectionDetails = React.useMemo(() => {
    if (!effectiveConnection) return null
    return llmConnections.find(c => c.slug === effectiveConnection) ?? null
  }, [llmConnections, effectiveConnection])

  const pickerMode = derivePickerMode({
    connectionUnavailable,
    connectionCount: llmConnections.length,
  })

  const liveOpenRouterModels = useLiveOpenRouterModels(
    !connectionUnavailable && llmConnections.some((connection) => isOpenRouterConnection(connection)),
  )

  const availableModels = React.useMemo(() => {
    if (connectionUnavailable) return []
    return resolvePickerModelsWithLive(effectiveConnectionDetails, liveOpenRouterModels)
  }, [effectiveConnectionDetails, connectionUnavailable, liveOpenRouterModels])

  const { query: modelSearchQuery, setQuery: setModelSearchQuery } = usePickerSearchQuery(open)
  const pinnedModelIds = React.useMemo(
    () => connectionPinnedModelIds(effectiveConnectionDetails),
    [effectiveConnectionDetails],
  )
  const visibleCatalog = useVisiblePickerModels(
    availableModels,
    modelSearchQuery,
    currentModel,
    pinnedModelIds,
  )
  const showModelSearch = shouldShowPickerSearch(availableModels.length, modelSearchQuery)

  const currentModelDisplayName = React.useMemo(() => {
    const model = availableModels.find(m =>
      isPickerModelSelected(currentModel, pickerModelId(m)),
    )
    if (!model) return stripPiPrefixForDisplay(getModelDisplayName(currentModel))
    if (typeof model === 'string') return stripPiPrefixForDisplay(model)
    return model.name ?? stripPiPrefixForDisplay(model.id)
  }, [availableModels, currentModel])

  const thinkingDisabled = React.useMemo(() => {
    const model = availableModels.find(
      m => typeof m !== 'string' && isPickerModelSelected(currentModel, m.id),
    )
    return typeof model !== 'string' && model?.supportsThinking === false
  }, [availableModels, currentModel])

  const connectionsByProvider = React.useMemo(
    () => groupConnectionsByProvider(llmConnections),
    [llmConnections],
  )

  const showConnectionIcon =
    !!effectiveConnectionDetails &&
    llmConnections.length > 1 &&
    storage.get(storage.KEYS.showConnectionIcons, true)

  // Collapse on close; re-open on the current connection so mid-session switches stay one tap away.
  React.useEffect(() => {
    if (!open) {
      setExpandedConnection(null)
      return
    }
    if (effectiveConnection) setExpandedConnection(effectiveConnection)
  }, [open, effectiveConnection])

  const handlePickFlatModel = React.useCallback(
    (modelId: string) => {
      onModelChange(modelId, effectiveConnection)
      setOpen(false)
    },
    [onModelChange, effectiveConnection],
  )

  const handlePickSwitcherModel = React.useCallback(
    (connSlug: string, modelId: string) => {
      const isCurrentConnection = effectiveConnection === connSlug
      if (!isCurrentConnection && onConnectionChange) {
        onConnectionChange(connSlug)
      }
      onModelChange(modelId, connSlug)
      setOpen(false)
    },
    [onModelChange, onConnectionChange, effectiveConnection],
  )

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label={connectionUnavailable
            ? t('common.unavailable')
            : `${t('common.model')}: ${currentModelDisplayName}`}
          className={cn(
            'h-7 pl-2 pr-2 text-xs font-medium rounded-[6px] flex items-center gap-1.5 shadow-tinted outline-none select-none min-w-[64px] shrink',
            connectionUnavailable
              ? 'bg-destructive/10 text-destructive'
              : 'bg-foreground/5 text-foreground/70',
          )}
          style={{ '--shadow-color': 'var(--foreground-rgb)' } as React.CSSProperties}
        >
          {connectionUnavailable ? (
            <>
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{t('common.unavailable')}</span>
            </>
          ) : (
            <>
              {showConnectionIcon && effectiveConnectionDetails && (
                <ConnectionIcon connection={effectiveConnectionDetails} size={14} />
              )}
              <span className="truncate min-w-0">{currentModelDisplayName}</span>
              <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
            </>
          )}
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('common.model')}</DrawerTitle>
        </DrawerHeader>

        <div className="px-2 pb-4 flex flex-col gap-0.5 max-h-[55vh] overflow-y-auto">
          {/* === Models section === */}
          {pickerMode === 'unavailable' ? (
            <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
              <AlertCircle className="h-8 w-8 text-destructive mb-2" />
              <div className="font-medium text-sm mb-1">
                {t('chat.connectionUnavailable')}
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {t('chat.connectionUnavailableDescription')}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate(routes.view.settings('ai'))
                }}
                className="text-xs underline text-foreground/70 hover:text-foreground"
              >
                {t('chat.modelPicker.openAiSettings')}
              </button>
            </div>
          ) : pickerMode === 'switcher' ? (
            connectionsByProvider.map(([providerName, connections]) => (
              <React.Fragment key={providerName}>
                <div className="px-3 pt-3 pb-1 text-xs font-medium text-foreground/60 uppercase tracking-wide select-none">
                  {providerName}
                </div>
                {connections.map(conn => {
                  const isCurrentConnection = effectiveConnection === conn.slug
                  const isAuthenticated = conn.isAuthenticated
                  const isExpanded = expandedConnection === conn.slug
                  return (
                    <React.Fragment key={conn.slug}>
                      <button
                        type="button"
                        disabled={!isAuthenticated}
                        onClick={() =>
                          setExpandedConnection(prev => (prev === conn.slug ? null : conn.slug))
                        }
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-left transition-colors',
                          !isAuthenticated && 'opacity-50 cursor-not-allowed',
                          isAuthenticated && 'hover:bg-foreground/5',
                          isCurrentConnection && !isExpanded && 'bg-foreground/5',
                        )}
                      >
                        <ConnectionIcon connection={conn} size={14} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{conn.name}</div>
                          {!isAuthenticated && (
                            <div className="text-xs text-muted-foreground">
                              {t('settings.ai.notAuthenticated')}
                            </div>
                          )}
                        </div>
                        {isCurrentConnection && (
                          <Check className="h-3 w-3 text-foreground/60 shrink-0" />
                        )}
                        {isAuthenticated && (
                          <ChevronRight
                            className={cn(
                              'h-3 w-3 opacity-60 shrink-0 transition-transform',
                              isExpanded && 'rotate-90',
                            )}
                          />
                        )}
                      </button>
                      {isAuthenticated && isExpanded && (
                        <CompactSwitcherModels
                          conn={conn}
                          liveOpenRouterModels={liveOpenRouterModels}
                          currentModel={currentModel}
                          isCurrentConnection={isCurrentConnection}
                          onPick={handlePickSwitcherModel}
                        />
                      )}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            ))
          ) : (
            <>
              {showModelSearch && (
                <ModelPickerSearchField
                  value={modelSearchQuery}
                  onChange={setModelSearchQuery}
                  className="px-1"
                />
              )}
              {visibleCatalog.visible.length === 0 ? (
                <ModelPickerEmptyResults />
              ) : (
                visibleCatalog.visible.map(model => {
              const modelId = pickerModelId(model)
              const modelName = typeof model === 'string'
                ? stripPiPrefixForDisplay(getModelShortName(model))
                : (model.name ?? stripPiPrefixForDisplay(model.id))
              const isSelected = isPickerModelSelected(currentModel, modelId)
              const descriptionKey =
                typeof model !== 'string' && 'descriptionKey' in model
                  ? (model.descriptionKey as string)
                  : undefined
              const description = descriptionKey
                ? t(descriptionKey)
                : (typeof model !== 'string' && 'description' in model
                    ? (model.description as string)
                    : '')
              return (
                <DrawerClose asChild key={modelId}>
                  <button
                    type="button"
                    onClick={() => handlePickFlatModel(modelId)}
                    className={cn(
                      'flex items-center justify-between w-full px-3 py-2 rounded-lg text-left transition-colors',
                      isSelected ? 'bg-foreground/5' : 'hover:bg-foreground/5',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{modelName}</div>
                      {description && (
                        <div className="text-xs text-foreground/50 truncate">
                          {description}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="h-3 w-3 text-foreground/60 ml-3 shrink-0" />
                    )}
                  </button>
                </DrawerClose>
              )
                })
              )}
              <ModelPickerOverflowHint
                hiddenCount={visibleCatalog.hiddenCount}
                searching={modelSearchQuery.trim().length > 0}
              />
            </>
          )}

          {/* === Thinking section === */}
          {THINKING_LEVELS.length > 0 && pickerMode !== 'unavailable' && (
            <>
              <div className="px-3 pt-4 pb-1 text-xs font-medium text-foreground/60 uppercase tracking-wide select-none">
                {t('chat.modelPicker.thinkingSection')}
              </div>
              {THINKING_LEVELS.map(({ id, nameKey, descriptionKey }) => {
                const isSelected = thinkingLevel === id
                return (
                  <DrawerClose asChild key={id}>
                    <button
                      type="button"
                      disabled={thinkingDisabled}
                      onClick={() => onThinkingLevelChange?.(id)}
                      className={cn(
                        'flex items-center justify-between w-full px-3 py-2 rounded-lg text-left transition-colors',
                        thinkingDisabled && 'opacity-50 cursor-not-allowed',
                        !thinkingDisabled && isSelected && 'bg-foreground/5',
                        !thinkingDisabled && !isSelected && 'hover:bg-foreground/5',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{t(nameKey)}</div>
                        <div className="text-xs text-foreground/50">
                          {t(descriptionKey)}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-3 w-3 text-foreground/60 shrink-0 ml-3" />
                      )}
                    </button>
                  </DrawerClose>
                )
              })}
            </>
          )}

          {/* === Context section === */}
          {contextStatus?.inputTokens != null && contextStatus.inputTokens > 0 && (
            <>
              <div className="px-3 pt-4 pb-1 text-xs font-medium text-foreground/60 uppercase tracking-wide select-none">
                {t('chat.modelPicker.contextSection')}
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-xs text-foreground/60 select-none">
                <span>{t('chat.context')}</span>
                <span className="flex items-center gap-1.5">
                  {contextStatus.isCompacting && <Spinner className="h-3 w-3" />}
                  {t('chat.tokensUsed', {
                    displayCount: formatTokenCount(contextStatus.inputTokens),
                  })}
                </span>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
