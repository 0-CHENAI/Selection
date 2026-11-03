import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, GripVertical } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { defaultSearchSettings, type SearchKeyProviderId, type SearchProviderId, type SearchSettings } from '@craft-agent/shared/config/search-settings'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SortableList } from '@/components/ui/sortable-list'
import { SettingsCard, SettingsSecretInput } from '@/components/settings'
import { notifyAdvancedSettingsChanged } from '@/hooks/useAdvancedSettings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = { navigator: 'settings', slug: 'advanced' }

const providerNames: Record<Exclude<SearchProviderId, 'native'>, string> = {
  deepseek: 'DeepSeek Web Search', tavily: 'Tavily', exa: 'Exa', anysearch: 'AnySearch', brave: 'Brave Search',
}

export default function AdvancedSettingsPage() {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const [settings, setSettings] = useState<SearchSettings | null>(null)
  const [keys, setKeys] = useState<Partial<Record<SearchKeyProviderId, boolean>>>({})
  const [loadError, setLoadError] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<SearchKeyProviderId | null>(null)
  const [keyInput, setKeyInput] = useState('')

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const value = await window.electronAPI.getAdvancedSettings()
      setSettings(value.searchSettings ?? defaultSearchSettings())
      setKeys(value.searchKeysConfigured ?? { anysearch: value.anySearchApiKeyConfigured })
      setUnsupported(value.searchSettings === undefined || value.searchKeysConfigured === undefined
        || typeof window.electronAPI.setSearchSettings !== 'function'
        || typeof window.electronAPI.setSearchProviderApiKey !== 'function'
        || !window.electronAPI.isChannelAvailable(RPC_CHANNELS.settings.SET_SEARCH_SETTINGS)
        || !window.electronAPI.isChannelAvailable(RPC_CHANNELS.settings.SET_SEARCH_PROVIDER_API_KEY))
    } catch {
      setLoadError(true)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const saveSettings = async (next: SearchSettings) => {
    if (busy || unsupported) return
    const previous = settings
    setSettings(next)
    setBusy(true)
    try {
      setSettings(await window.electronAPI.setSearchSettings(next))
      notifyAdvancedSettingsChanged()
    } catch (error) {
      setSettings(previous)
      if ((error as { code?: string })?.code === 'CHANNEL_NOT_FOUND') setUnsupported(true)
      else toast.error(t('settings.search.saveFailed'), { description: error instanceof Error ? error.message : undefined })
    } finally { setBusy(false) }
  }

  const saveKey = async (provider: SearchKeyProviderId, value: string) => {
    if (busy || unsupported) return
    setBusy(true)
    try {
      const result = await window.electronAPI.setSearchProviderApiKey(provider, value.trim())
      setKeys(previous => ({ ...previous, [provider]: result.configured }))
      setKeyInput('')
      setEditing(null)
      notifyAdvancedSettingsChanged()
      toast.success(t('settings.search.keySaved'))
    } catch (error) {
      if ((error as { code?: string })?.code === 'CHANNEL_NOT_FOUND') setUnsupported(true)
      else toast.error(t('settings.search.saveFailed'))
    } finally { setBusy(false) }
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.advanced.title')} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <SettingsCard divided={false} className="overflow-visible border border-border/60">
              <div className="px-5 py-4">
            <h2 className="text-base font-medium">{t('settings.search.providers')}</h2>
            <p className="mt-2 mb-5 text-sm text-muted-foreground">{t('settings.search.description')}</p>
            {unsupported && <p role="alert" className="mb-4 text-sm text-destructive">{t('settings.search.versionUnsupported')}</p>}
            {loadError ? (
              <div className="text-sm text-muted-foreground">
                {t('settings.search.loadFailed')}{' '}
                <Button variant="link" size="sm" onClick={() => void load()}>{t('settings.search.retry')}</Button>
              </div>
            ) : !settings ? <p className="text-sm text-muted-foreground">{t('settings.search.loading')}</p> : (
              <SortableList
                items={settings.providers}
                handleOnly
                dragAnywhere
                verticalOnly
                constrainToList
                disabled={busy || unsupported}
                showOverlay={false}
                className="divide-y divide-foreground/15"
                onReorder={providers => void saveSettings({ providers })}
                renderItem={(item, isDragging, handleProps) => {
                  const name = item.id === 'native' ? t('settings.search.native') : providerNames[item.id]
                  const keyProvider = item.id === 'native' ? null : item.id
                  const configured = keyProvider ? !!keys[keyProvider] : false
                  const status = !keyProvider ? t('settings.search.nativeDesc')
                    : configured ? t('settings.search.keyConfigured')
                    : keyProvider === 'anysearch' ? t('settings.search.keyOptional') : t('settings.search.keyMissing')
                  return (
                    <div className={`select-none py-3 ${isDragging ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-3">
                        <button type="button" {...handleProps} disabled={busy || unsupported} aria-label={t('settings.search.drag', { name })} className="touch-none cursor-grab text-muted-foreground hover:text-foreground disabled:opacity-50">
                          <GripVertical className="size-4" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{status}</div>
                        </div>
                        {keyProvider && <Button data-no-dnd="true" variant="ghost" size="sm" disabled={busy || unsupported} aria-label={`${name} ${t('settings.search.apiKey')}`} aria-expanded={editing === keyProvider} aria-controls={editing === keyProvider ? `search-key-${keyProvider}` : undefined} onClick={() => { setEditing(editing === keyProvider ? null : keyProvider); setKeyInput('') }}>
                          {t('settings.search.apiKey')}
                          <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform duration-200 motion-reduce:transition-none ${editing === keyProvider ? 'rotate-180' : ''}`} />
                        </Button>}
                        <Switch data-no-dnd="true" checked={item.enabled} disabled={busy || unsupported} aria-label={t('settings.search.enable', { name })} onCheckedChange={enabled => void saveSettings({ providers: settings.providers.map(provider => provider.id === item.id ? { ...provider, enabled } : provider) })} />
                      </div>
                      <AnimatePresence initial={false}>
                        {keyProvider && editing === keyProvider && (
                          <motion.div data-no-dnd="true" id={`search-key-${keyProvider}`} key={keyProvider} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }} className="select-text overflow-hidden">
                            <div className="ml-7 mt-4 space-y-3 pb-1">
                              <SettingsSecretInput label={t('settings.search.apiKey')} description={t('settings.search.keyDescription')} value={keyInput} onChange={setKeyInput} placeholder={t('settings.search.keyPlaceholder')} disabled={busy} />
                              <div className="flex justify-end gap-2">
                                {configured && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void saveKey(keyProvider, '')}>{t('common.clear')}</Button>}
                                <motion.div animate={{ opacity: keyInput.trim() ? 1 : 0.65 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
                                  <Button size="sm" disabled={busy || !keyInput.trim()} onClick={() => void saveKey(keyProvider, keyInput)}>{busy ? t('common.saving') : t('common.save')}</Button>
                                </motion.div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                }}
              />
            )}
              </div>
            </SettingsCard>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
