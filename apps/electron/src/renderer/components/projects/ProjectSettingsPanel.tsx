/**
 * Project settings, grouped the same way as the rest of Settings:
 * basics, working folder, AI instructions, retrieval, then danger.
 * Metadata stays in a collapsed footer.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { InlineColorPickerRow } from '@/components/ui/inline-color-picker-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { PROJECT_COLOR_PALETTE } from '@/utils/project-colors'
import { projectWorkingDirectorySaveIssue } from '@craft-agent/shared/projects/working-directory'

export interface ProjectSettingsPanelProps {
  name: string
  description: string
  storedWorkingDirectory?: string
  workingDirectory: string
  details: string
  historySearch: boolean
  color: string
  slug: string
  folderPath: string
  saving: boolean
  folderError: 'cleared' | null
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onDetailsChange: (value: string) => void
  onHistorySearchChange: (value: boolean) => void
  onColorChange: (value: string) => void
  onPickFolder: () => void
  onSave: () => void
  onDelete: () => void
  onOpenLocation: () => void
  /** Resources sit on the same page, after the single save action. */
  resources?: React.ReactNode
}

export function ProjectSettingsPanel({
  name,
  description,
  storedWorkingDirectory,
  workingDirectory,
  details,
  historySearch,
  color,
  slug,
  folderPath,
  saving,
  folderError,
  onNameChange,
  onDescriptionChange,
  onDetailsChange,
  onHistorySearchChange,
  onColorChange,
  onPickFolder,
  onSave,
  onDelete,
  onOpenLocation,
  resources,
}: ProjectSettingsPanelProps) {
  const { t } = useTranslation()
  const folderState = projectWorkingDirectorySaveIssue({
    storedWorkingDirectory,
    nextWorkingDirectory: workingDirectory,
  })
  const missing = folderState === 'missing'
  const pathLabel = workingDirectory.trim()

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('projectInfo.settingsBasic')}
        description={t('projectInfo.settingsBasicHint')}
      >
        <SettingsCard>
          <div className="space-y-3 px-4 py-3.5">
            <Field label={t('projectInfo.title')} htmlFor="project-settings-name">
              <Input id="project-settings-name" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={name} />
            </Field>
            <Field label={t('projectInfo.description')} htmlFor="project-settings-description">
              <Input
                id="project-settings-description"
                value={description}
                onChange={(event) => onDescriptionChange(event.target.value)}
                placeholder={t('projectInfo.descriptionPlaceholder')}
              />
            </Field>
          </div>
          <div className="px-4 py-3.5">
            <Field label={t('projectInfo.color')} hint={t('projectInfo.colorHint')}>
              <InlineColorPickerRow
                value={color}
                onChange={onColorChange}
                presets={PROJECT_COLOR_PALETTE}
                onClear={() => onColorChange('')}
                clearLabel={t('projectInfo.colorClear')}
                customAriaLabel={t('projectInfo.colorCustom')}
              />
            </Field>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('projectInfo.settingsFolder')}
        description={t('projectInfo.settingsFolderHint')}
      >
        <SettingsCard>
          <div className="space-y-3 px-4 py-4">
            {missing && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
                {t('projectInfo.settingsFolderMissing')}
              </div>
            )}
            {folderError === 'cleared' && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {t('projectInfo.settingsFolderRequired')}
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04] text-foreground">
                <FolderOpen className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t('projectInfo.workingDirectory')}</div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      tabIndex={pathLabel ? 0 : undefined}
                      className={cn('truncate text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring', pathLabel ? 'font-mono text-foreground/80' : 'text-muted-foreground')}
                      title={pathLabel || undefined}
                    >
                      {pathLabel || t('projectsList.createDialogFolderPlaceholder')}
                    </div>
                  </TooltipTrigger>
                  {pathLabel && <TooltipContent className="max-w-sm break-all">{pathLabel}</TooltipContent>}
                </Tooltip>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={onPickFolder}>
                {pathLabel ? t('projectInfo.settingsFolderChange') : t('projectsList.createDialogFolderButton')}
              </Button>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('projectInfo.settingsInstructions')}
        description={t('projectInfo.detailsHelpText')}
      >
        <SettingsCard>
          <div className="p-4">
            <Textarea
              id="project-settings-instructions"
              value={details}
              onChange={(event) => onDetailsChange(event.target.value)}
              rows={6}
              placeholder={t('projectInfo.detailsPlaceholder')}
              className="min-h-32 resize-none border-foreground/15 bg-transparent shadow-none field-sizing-fixed focus-visible:border-foreground/15 focus-visible:ring-foreground/30 dark:bg-transparent"
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('projectInfo.settingsRetrieval')}
        description={t('projectInfo.historySearchHint')}
      >
        <SettingsCard>
          <SettingsToggle
            label={t('projectInfo.historySearch')}
            description={t('projectInfo.historySearchEnable')}
            checked={historySearch}
            onCheckedChange={onHistorySearchChange}
          />
        </SettingsCard>
      </SettingsSection>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>

      {resources}

      <SettingsSection
        variant="danger"
        title={t('projectInfo.settingsDanger')}
        description={t('projectInfo.settingsDangerHint')}
      >
        <SettingsCard>
          <SettingsRow
            label={t('projectInfo.deleteProject')}
            action={(
              <Button variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t('projectInfo.deleteProject')}
              </Button>
            )}
          />
        </SettingsCard>
      </SettingsSection>

      <details className="rounded-xl bg-foreground/[0.03] px-4 py-3 text-muted-foreground">
        <summary className="cursor-pointer text-xs font-medium">
          {t('projectInfo.metadataSummary')}
        </summary>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex items-baseline gap-3">
            <dt className="w-16 shrink-0">{t('common.slug')}</dt>
            <dd className="min-w-0 truncate font-mono">{slug}</dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="w-16 shrink-0">{t('common.location')}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono">{folderPath}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onOpenLocation}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground/50 hover:bg-foreground/5 hover:text-foreground"
                    aria-label={t('projectInfo.openLocation')}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('projectInfo.openLocation')}</TooltipContent>
              </Tooltip>
            </dd>
          </div>
        </dl>
      </details>
    </div>
  )
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="block">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-foreground/70">{label}</label>
      ) : (
        <div className="mb-1 text-xs font-medium text-foreground/70">{label}</div>
      )}
      {children}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
