/**
 * PPT image slots: Seedream (Volcengine Ark) or OpenAI Images.
 * The API key is write-only. Saving runs one non-generating connection check on the server.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  SettingsCard,
  SettingsInput,
  SettingsMenuSelect,
  SettingsRow,
  SettingsSecretInput,
  SettingsSection,
  SettingsSegmentedControl,
} from '@/components/settings'
import type { ImageGenerationProvider, ImageGenerationSettings } from '../../../shared/types'

const CUSTOM_MODEL = '__custom__'

export function ImageGenerationSettingsCard() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<ImageGenerationSettings | null>(null)
  const [provider, setProvider] = useState<ImageGenerationProvider>('bytedance')
  const [model, setModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!window.electronAPI?.getImageGenerationSettings) return
    const next = await window.electronAPI.getImageGenerationSettings()
    setSettings(next)
    setProvider(next.provider)
    setBaseUrl(next.baseUrl)
    if (next.models[next.provider].includes(next.model)) {
      setModel(next.model)
      setCustomModel('')
    } else {
      setModel(CUSTOM_MODEL)
      setCustomModel(next.model)
    }
  }, [])

  useEffect(() => {
    void load().catch(() => setSettings(null))
  }, [load])

  const changeProvider = useCallback((next: ImageGenerationProvider) => {
    setProvider(next)
    if (!settings) return
    const saved = settings.configured && settings.provider === next
    setBaseUrl(saved ? settings.baseUrl : settings.defaults[next].baseUrl)
    const nextModel = saved ? settings.model : settings.defaults[next].model
    if (settings.models[next].includes(nextModel)) {
      setModel(nextModel)
      setCustomModel('')
    } else {
      setModel(CUSTOM_MODEL)
      setCustomModel(nextModel)
    }
  }, [settings])

  const modelOptions = useMemo(() => {
    if (!settings) return []
    return [
      ...settings.models[provider].map(id => ({ value: id, label: id })),
      { value: CUSTOM_MODEL, label: t('settings.advanced.imageModelCustom') },
    ]
  }, [provider, settings, t])

  const keepsSavedKey = Boolean(settings?.configured && settings.provider === provider)
  const effectiveModel = model === CUSTOM_MODEL ? customModel.trim() : model
  const canSave = Boolean(settings) && !saving && Boolean(effectiveModel) && (Boolean(apiKey.trim()) || keepsSavedKey)

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await window.electronAPI.setImageGenerationSettings({ provider, baseUrl: baseUrl.trim(), model: effectiveModel, apiKey: apiKey.trim() })
      setApiKey('')
      await load()
      toast.success(t('settings.advanced.imageSaved'))
    } catch (error) {
      toast.error(t('settings.advanced.imageSaveFailed'), {
        description: error instanceof Error ? error.message : t('toast.unknownError'),
      })
    } finally {
      setSaving(false)
    }
  }, [apiKey, baseUrl, effectiveModel, load, provider, t])

  const clear = useCallback(async () => {
    setSaving(true)
    try {
      await window.electronAPI.setImageGenerationSettings(null)
      setApiKey('')
      await load()
      toast.success(t('settings.advanced.imageCleared'))
    } catch (error) {
      toast.error(t('settings.advanced.imageSaveFailed'), {
        description: error instanceof Error ? error.message : t('toast.unknownError'),
      })
    } finally {
      setSaving(false)
    }
  }, [load, t])

  if (!settings) return null

  return (
    <SettingsSection title={t('settings.advanced.imageGeneration')} description={t('settings.advanced.imageGenerationDesc')}>
      <SettingsCard>
        <SettingsRow label={t('settings.advanced.imageProvider')}>
          <SettingsSegmentedControl
            value={provider}
            onValueChange={value => changeProvider(value as ImageGenerationProvider)}
            options={[
              { value: 'bytedance', label: t('settings.advanced.imageProviderBytedance') },
              { value: 'openai', label: t('settings.advanced.imageProviderOpenai') },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.advanced.imageModel')}>
          <SettingsMenuSelect value={model} onValueChange={setModel} options={modelOptions} disabled={saving} />
        </SettingsRow>
        <div className="px-4 py-3.5 space-y-3">
          {model === CUSTOM_MODEL && (
            <SettingsInput
              label={t('settings.advanced.imageModelCustom')}
              value={customModel}
              onChange={setCustomModel}
              placeholder={t('settings.advanced.imageModelCustomPlaceholder')}
              disabled={saving}
            />
          )}
          <SettingsInput
            label={t('settings.advanced.imageBaseUrl')}
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder={settings.defaults[provider].baseUrl}
            type="url"
            disabled={saving}
          />
          <SettingsSecretInput
            label={t('settings.advanced.imageApiKey')}
            description={keepsSavedKey ? t('settings.advanced.imageApiKeyConfigured') : t('settings.advanced.imageApiKeyDesc')}
            value={apiKey}
            onChange={setApiKey}
            placeholder={keepsSavedKey ? t('settings.advanced.anySearchApiKeyReplace') : t('settings.advanced.imageApiKey')}
            disabled={saving}
          />
          <div className="flex justify-end gap-2">
            {settings.configured && (
              <Button variant="ghost" size="sm" onClick={clear} disabled={saving}>
                {t('common.clear')}
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!canSave}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
