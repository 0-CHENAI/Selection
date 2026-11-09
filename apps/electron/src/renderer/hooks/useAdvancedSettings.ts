import { useCallback, useEffect, useState } from 'react'

export interface AdvancedSettings {
  dagOrchestrationEnabled: boolean
  swarmAgentsEnabled: boolean
  anySearchApiKeyConfigured: boolean
}

const DISABLED_ADVANCED_SETTINGS: AdvancedSettings = {
  dagOrchestrationEnabled: false,
  swarmAgentsEnabled: false,
  anySearchApiKeyConfigured: false,
}

const CHANGE_EVENT = 'selection-advanced-settings-changed'

async function readAdvancedSettings(): Promise<AdvancedSettings> {
  if (!window.electronAPI?.getAdvancedSettings) return DISABLED_ADVANCED_SETTINGS
  return window.electronAPI.getAdvancedSettings()
}

/** Read the app-level advanced switches and refresh when this window changes them. */
export function useAdvancedSettings(): AdvancedSettings {
  const [settings, setSettings] = useState<AdvancedSettings>(DISABLED_ADVANCED_SETTINGS)

  const refresh = useCallback(() => {
    void readAdvancedSettings().then(setSettings).catch(() => setSettings(DISABLED_ADVANCED_SETTINGS))
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(CHANGE_EVENT, refresh)
    return () => window.removeEventListener(CHANGE_EVENT, refresh)
  }, [refresh])

  return settings
}

export function notifyAdvancedSettingsChanged(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
