import * as React from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Spinner } from '@craft-agent/ui'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SettingsInput, SettingsSecretInput, SettingsSegmentedControl } from '@/components/settings'
import { LarkSetupGuide } from './LarkSetupGuide'
import { LarkIcon } from './MessagingPlatformIcon'

interface LarkConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reconfigure?: boolean
  onSaved?: () => void
}

type LarkDomain = 'feishu' | 'lark'
type Phase = 'editing' | 'testing' | 'verified' | 'saving'

export function LarkConnectDialog({ open, onOpenChange, reconfigure, onSaved }: LarkConnectDialogProps) {
  const { t } = useTranslation()
  const [domain, setDomain] = React.useState<LarkDomain>('feishu')
  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [phase, setPhase] = React.useState<Phase>('editing')
  const [error, setError] = React.useState('')
  const busy = phase === 'testing' || phase === 'saving'
  const verified = phase === 'verified' || phase === 'saving'
  const ready = Boolean(appId.trim() && appSecret.trim())

  function clearValidation() {
    setError('')
    setPhase('editing')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    const credentials = { appId: appId.trim(), appSecret: appSecret.trim(), domain }
    setError('')
    setPhase(verified ? 'saving' : 'testing')
    try {
      if (verified) {
        await window.electronAPI.saveLarkCredentials(credentials)
        toast.success(t('settings.messaging.lark.saved'))
        onSaved?.()
        onOpenChange(false)
      } else {
        const result = await window.electronAPI.testLarkCredentials(credentials)
        if (!result.success) throw new Error(result.error || t('common.error'))
        setPhase('verified')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
      setPhase('editing')
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (phase !== 'saving') onOpenChange(next) }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl sm:max-w-[420px]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2.5">
            <LarkIcon size={24} />
            {t(reconfigure ? 'settings.messaging.lark.reconfigureTitle' : 'settings.messaging.lark.connectTitle')}
          </DialogTitle>
          <DialogDescription>{t('settings.messaging.lark.credentialHint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t('settings.messaging.lark.domainLabel')}</span>
              <SettingsSegmentedControl<LarkDomain>
                value={domain}
                onValueChange={next => {
                  if (next !== domain) { setDomain(next); clearValidation() }
                }}
                options={[
                  { value: 'feishu', label: t('settings.messaging.lark.domainFeishu') },
                  { value: 'lark', label: t('settings.messaging.lark.domainLark') },
                ]}
                size="sm"
                className="rounded-lg bg-muted/60 p-0.5"
              />
            </div>
            <SettingsInput
              label={t('settings.messaging.lark.appIdLabel')}
              value={appId}
              onChange={value => { setAppId(value); clearValidation() }}
              placeholder={t('settings.messaging.lark.appIdPlaceholder')}
            />
            <SettingsSecretInput
              label={t('settings.messaging.lark.appSecretLabel')}
              value={appSecret}
              onChange={value => { setAppSecret(value); clearValidation() }}
              placeholder={t('settings.messaging.lark.appSecretPlaceholder')}
            />
          </fieldset>

          <LarkSetupGuide domain={domain} appId={appId} />

          {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
          <DialogFooter className="items-center">
            {verified && (
              <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground sm:mr-auto">
                <Check className="size-3.5 text-success" />{t('settings.messaging.lark.testOk')}
              </span>
            )}
            <Button type="button" variant="ghost" size="sm" disabled={phase === 'saving'} onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!ready || busy}>
              {busy && <Spinner className="text-[14px]" />}
              {t(verified ? 'settings.messaging.lark.save' : 'settings.messaging.lark.testConnection')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
