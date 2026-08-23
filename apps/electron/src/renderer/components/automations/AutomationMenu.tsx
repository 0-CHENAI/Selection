/**
 * AutomationMenu - Shared menu content for automation actions
 *
 * Used by:
 * - AutomationsListPanel (dropdown via "..." button, context menu via right-click)
 * - AutomationInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, following the same dual-menu pattern as SourceMenu.
 */

import { useTranslation } from 'react-i18next'
import {
  Trash2,
  FileCode,
  Copy,
  Play,
  Loader2,
  Search,
  Power,
  PowerOff,
  Send,
  Download,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import type { TestResult } from './types'

export interface AutomationMenuProps {
  automationId: string
  automationName: string
  enabled: boolean
  testResult?: TestResult
  onToggleEnabled?: () => void
  onTest?: () => void
  onSimulateMatch?: () => void
  onDuplicate?: () => void
  onEditJson?: () => void
  onDelete?: () => void
  /** Send to another workspace (omit to hide the option) */
  onSendToWorkspace?: () => void
  onExport?: () => void
}

export function AutomationMenu({
  automationId,
  automationName,
  enabled,
  testResult,
  onToggleEnabled,
  onTest,
  onSimulateMatch,
  onDuplicate,
  onEditJson,
  onDelete,
  onSendToWorkspace,
  onExport,
}: AutomationMenuProps) {
  const { MenuItem, Separator } = useMenuComponents()
  const { t } = useTranslation()
  const appShellContext = useOptionalAppShellContext()
  const resolvedTestResult = testResult ?? appShellContext?.automationTestResults?.[automationId]
  const isRunning = resolvedTestResult?.state === 'running'
  const isMatchRunning = isRunning && resolvedTestResult.mode === 'match'
  const isActionTestRunning = isRunning && !isMatchRunning

  return (
    <>
      {/* Toggle enabled/disabled */}
      {onToggleEnabled && (
        <MenuItem onClick={onToggleEnabled}>
          {enabled ? (
            <PowerOff className="h-3.5 w-3.5" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          <span className="flex-1">{enabled ? t('automations.menuDisable') : t('automations.menuEnable')}</span>
        </MenuItem>
      )}

      {/* Test Automation */}
      {onTest && (
        <MenuItem onClick={onTest} disabled={isRunning}>
          {isActionTestRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          <span className="flex-1">
            {isActionTestRunning ? t('automations.testRunning') : t('automations.runTest')}
          </span>
        </MenuItem>
      )}

      {onSimulateMatch && (
        <MenuItem onClick={onSimulateMatch} disabled={isRunning}>
          {isMatchRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          <span className="flex-1">
            {isMatchRunning ? t('automations.testRunning') : t('automations.matchSimulate')}
          </span>
        </MenuItem>
      )}

      {/* Duplicate */}
      {onDuplicate && (
        <MenuItem onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
          <span className="flex-1">{t('automations.menuDuplicate')}</span>
        </MenuItem>
      )}

      {/* Send to another workspace */}
      {onSendToWorkspace && (
        <MenuItem onClick={onSendToWorkspace}>
          <Send className="h-3.5 w-3.5" />
          <span className="flex-1">{t('sendToWorkspace.title')}</span>
        </MenuItem>
      )}


      {onExport && (
        <MenuItem onClick={onExport}>
          <Download className="h-3.5 w-3.5" />
          <span className="flex-1">{t('resourceTransfer.exportMenu')}</span>
        </MenuItem>
      )}

      {/* Edit automations.json */}
      {onEditJson && (
        <MenuItem onClick={onEditJson}>
          <FileCode className="h-3.5 w-3.5" />
          <span className="flex-1">{t('automations.menuEditConfiguration')}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      {onDelete && (
        <MenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="h-3.5 w-3.5" />
          <span className="flex-1">{t('automations.menuDelete')}</span>
        </MenuItem>
      )}
    </>
  )
}
