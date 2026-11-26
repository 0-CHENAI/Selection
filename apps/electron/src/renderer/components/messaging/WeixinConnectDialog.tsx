import * as React from 'react'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@/components/ui/dialog'
import { WeixinIcon } from './MessagingPlatformIcon'

export function WeixinConnectDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const [generation, setGeneration] = React.useState(0)
  const [qr, setQr] = React.useState('')
  const [alreadyBound, setAlreadyBound] = React.useState(false)
  const [needsPin, setNeedsPin] = React.useState(false)
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState('')
  const resume = React.useRef<((pin: string) => void) | null>(null)

  React.useEffect(() => {
    if (!window.electronAPI.weixinLogin || !window.electronAPI.isChannelAvailable(RPC_CHANNELS.messaging.WEIXIN_LOGIN)) {
      setError(t('settings.messaging.weixin.update'))
      return
    }
    const attempt = crypto.randomUUID()
    let active = true
    setQr('')
    setPin('')
    setError('')
    setAlreadyBound(false)
    setNeedsPin(false)
    async function login() {
      const result = await window.electronAPI.weixinLogin({ attempt, action: 'start' })
      if (!active) return
      if (result.status !== 'qr') throw new Error(t('settings.messaging.weixin.expired'))
      setQr(result.content)
      let code: string | undefined
      while (active) {
        const next = await window.electronAPI.weixinLogin({ attempt, action: 'poll', pin: code })
        code = undefined
        if (!active) return
        if (next.status === 'connected') { onOpenChange(false); return }
        if (next.status === 'qr') {
          setQr(next.content)
        } else if (next.status === 'already_bound') {
          setAlreadyBound(true)
          return
        } else if (next.status === 'pin') {
          setNeedsPin(true)
          code = await new Promise<string>(resolve => { resume.current = resolve })
        } else if (next.status === 'expired' || next.status === 'cancelled') {
          setError(t('settings.messaging.weixin.expired'))
          return
        } else {
          await new Promise(resolve => setTimeout(resolve, 900))
        }
      }
    }
    void login().catch(err => { if (active) setError(err instanceof Error ? err.message : t('common.error')) })
    return () => {
      active = false
      resume.current?.('')
      resume.current = null
      void window.electronAPI.weixinLogin({ attempt, action: 'cancel' }).catch(() => {})
    }
  }, [generation, onOpenChange, t])

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><WeixinIcon size={22} />{t('settings.messaging.weixin.title')}</DialogTitle>
          <DialogDescription>{t('settings.messaging.weixin.scan')}</DialogDescription>
        </DialogHeader>
        {alreadyBound ? (
          <div className="space-y-3">
            <p role="status" className="text-sm">{t('settings.messaging.weixin.alreadyBound')}</p>
            <Button size="sm" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          </div>
        ) : error ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button size="sm" onClick={() => setGeneration(value => value + 1)}>{t('common.retry')}</Button>
          </div>
        ) : needsPin ? (
          <form className="space-y-3" onSubmit={event => {
            event.preventDefault()
            if (!/^\d+$/.test(pin)) return
            resume.current?.(pin)
            resume.current = null
            setNeedsPin(false)
            setPin('')
          }}>
            <label className="block text-sm">{t('settings.messaging.weixin.pin')}
              <input autoFocus type="password" inputMode="numeric" autoComplete="one-time-code"
                className="mt-2 block w-full rounded-md border bg-background p-2" value={pin} onChange={e => setPin(e.target.value)} />
            </label>
            <Button type="submit" size="sm" disabled={!/^\d+$/.test(pin)}>{t('common.continue')}</Button>
          </form>
        ) : qr ? (
          <QRCodeSVG value={qr} size={200} marginSize={4} className="mx-auto rounded-md" title={t('settings.messaging.weixin.scan')} />
        ) : <p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>}
      </DialogContent>
    </Dialog>
  )
}
