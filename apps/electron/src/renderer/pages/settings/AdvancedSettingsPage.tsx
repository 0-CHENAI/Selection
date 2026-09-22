/**
 * AdvancedSettingsPage
 *
 * App-level capability switches that are off unless explicitly enabled:
 * DAG orchestration, Swarm agents, and the optional AnySearch API key.
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  SettingsCard,
  SettingsSecretInput,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { notifyAdvancedSettingsChanged, useAdvancedSettings } from '@/hooks/useAdvancedSettings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'advanced',
}

export default function AdvancedSettingsPage() {
  const { t } = useTranslation()
  const advanced = useAdvancedSettings()
  const [anySearchApiKey, setAnySearchApiKey] = useState('')
  const [isSavingAnySearchApiKey, setIsSavingAnySearchApiKey] = useState(false)

  const handleDagOrchestrationChange = useCallback(async (enabled: boolean) => {
    await window.electronAPI.setDagOrchestrationEnabled(enabled)
    notifyAdvancedSettingsChanged()
  }, [])

  const handleSwarmAgentsChange = useCallback(async (enabled: boolean) => {
    await window.electronAPI.setSwarmAgentsEnabled(enabled)
    notifyAdvancedSettingsChanged()
  }, [])

  const handleSaveAnySearchApiKey = useCallback(async () => {
    const apiKey = anySearchApiKey.trim()
    if (!apiKey) return
    setIsSavingAnySearchApiKey(true)
    try {
      await window.electronAPI.setAnySearchApiKey(apiKey)
      setAnySearchApiKey('')
      notifyAdvancedSettingsChanged()
      toast.success(t('settings.advanced.anySearchApiKeySaved'))
    } catch (error) {
      toast.error(t('settings.advanced.anySearchApiKeySaveFailed'), {
        description: error instanceof Error ? error.message : t('toast.unknownError'),
      })
    } finally {
      setIsSavingAnySearchApiKey(false)
    }
  }, [anySearchApiKey, t])

  const handleClearAnySearchApiKey = useCallback(async () => {
    setIsSavingAnySearchApiKey(true)
    try {
      await window.electronAPI.setAnySearchApiKey('')
      setAnySearchApiKey('')
      notifyAdvancedSettingsChanged()
      toast.success(t('settings.advanced.anySearchApiKeyCleared'))
    } catch (error) {
      toast.error(t('settings.advanced.anySearchApiKeySaveFailed'), {
        description: error instanceof Error ? error.message : t('toast.unknownError'),
      })
    } finally {
      setIsSavingAnySearchApiKey(false)
    }
  }, [t])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.advanced.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              <SettingsSection title={t('settings.advanced.dagOrchestration')}>
                <SettingsCard>
                  <SettingsToggle
                    label={t('settings.advanced.dagOrchestration')}
                    description={t('settings.advanced.dagOrchestrationDesc')}
                    checked={advanced.dagOrchestrationEnabled}
                    onCheckedChange={handleDagOrchestrationChange}
                  />
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.advanced.swarmAgents')}>
                <SettingsCard>
                  <SettingsToggle
                    label={t('settings.advanced.swarmAgents')}
                    description={t('settings.advanced.swarmAgentsDesc')}
                    checked={advanced.swarmAgentsEnabled}
                    onCheckedChange={handleSwarmAgentsChange}
                  />
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.advanced.anySearchApiKey')}>
                <SettingsCard>
                  <div className="px-4 py-3.5 space-y-3">
                    <SettingsSecretInput
                      label={t('settings.advanced.anySearchApiKey')}
                      description={advanced.anySearchApiKeyConfigured
                        ? t('settings.advanced.anySearchApiKeyConfigured')
                        : t('settings.advanced.anySearchApiKeyDesc')}
                      value={anySearchApiKey}
                      onChange={setAnySearchApiKey}
                      placeholder={advanced.anySearchApiKeyConfigured
                        ? t('settings.advanced.anySearchApiKeyReplace')
                        : t('settings.advanced.anySearchApiKeyPlaceholder')}
                      disabled={isSavingAnySearchApiKey}
                    />
                    <div className="flex justify-end gap-2">
                      {advanced.anySearchApiKeyConfigured && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleClearAnySearchApiKey}
                          disabled={isSavingAnySearchApiKey}
                        >
                          {t('common.clear')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={handleSaveAnySearchApiKey}
                        disabled={!anySearchApiKey.trim() || isSavingAnySearchApiKey}
                      >
                        {isSavingAnySearchApiKey ? t('common.saving') : t('common.save')}
                      </Button>
                    </div>
                  </div>
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
