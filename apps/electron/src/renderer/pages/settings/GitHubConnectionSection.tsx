import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings2, Unlink2 } from 'lucide-react'
import { RPC_CHANNELS, SELECTION_GITHUB_APP_SLUG, SELECTION_GITHUB_INSTALL_URL, type GitHubConnectionStatus, type GitHubConnectionAction } from '@craft-agent/shared/protocol'
import { SettingsCard, SettingsSection, SettingsRow } from '@/components/settings'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'

const verificationUrl = 'https://github.com/login/device'

export function GitHubConnectionSection() {
  const { t } = useTranslation()
  const [connection, setConnection] = useState<GitHubConnectionStatus>()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const available = window.electronAPI.isChannelAvailable(RPC_CHANNELS.settings.GITHUB_APP)
  const update = useCallback(async (action: GitHubConnectionAction) => {
    if (!available || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFailed(false)
    try {
      const next = await window.electronAPI.githubAppConnection(action)
      setConnection(next)
      if (action === 'connect' && next.state === 'pending') await window.electronAPI.openUrl(verificationUrl)
      if (action === 'poll' && next.state === 'install') await window.electronAPI.openUrl(SELECTION_GITHUB_INSTALL_URL)
    } catch { setFailed(true) }
    finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [available])

  useEffect(() => { void update('status') }, [update])
  useEffect(() => {
    if (connection?.state !== 'pending' || failed) return
    const timer = window.setInterval(() => void update('poll'), 5000)
    return () => window.clearInterval(timer)
  }, [connection?.state, failed, update])
  useEffect(() => {
    if (connection?.state !== 'install' && connection?.state !== 'connected') return
    const refresh = () => void update('status')
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [connection?.state, update])

  const account = connection?.state === 'connected' || connection?.state === 'install' ? connection : undefined
  const manageRepositoriesLabel = t('settings.github.repositories')
  const disconnectLabel = t('common.disconnect')
  return (
    <SettingsSection title="GitHub" description={t('settings.github.description')}>
      <SettingsCard>
        <SettingsRow label={available && !failed && account ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar key={account.login} className="size-7" aria-hidden="true">
              <AvatarImage src={`https://github.com/${encodeURIComponent(account.login)}.png?size=64`} alt="" referrerPolicy="no-referrer" />
              <AvatarFallback className="text-xs">{account.login.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="truncate" title={account.login}>{account.login}</span>
            <span className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium leading-4 text-success">
              {t('settings.github.authenticated')}
            </span>
          </span>
        ) : SELECTION_GITHUB_APP_SLUG + '[bot]'} description={
          !available ? t('common.unavailable') : failed ? t('settings.github.failed')
            : !connection ? t('settings.search.loading') : connection.state === 'pending' ? t('onboarding.credentials.enterCodeOnGitHub')
            : connection.state === 'disconnected' ? t('settings.github.disconnected')
            : connection.state === 'install' ? t('settings.github.install')
            : connection.serviceAvailable ? undefined : t('settings.github.serviceUnavailable')
        }>
          {available && failed && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void update(connection?.state === 'pending' ? 'poll' : 'status')}>{t('common.retry')}</Button>}
          {connection?.state === 'disconnected' && <Button size="sm" disabled={busy} onClick={() => void update('connect')}>{t('settings.github.authorize')}</Button>}
          {connection?.state === 'pending' && <>
            <code className="select-all">{connection.userCode}</code>
            <Button variant="outline" size="sm" onClick={() => void window.electronAPI.openUrl(verificationUrl)}>{t('common.open')}</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void update('disconnect')}>{t('common.cancel')}</Button>
          </>}
          {(connection?.state === 'install' || connection?.state === 'connected') && <>
            <HeaderIconButton
              icon={<Settings2 className="size-4" aria-hidden="true" />}
              aria-label={manageRepositoriesLabel}
              tooltip={manageRepositoriesLabel}
              onClick={() => void window.electronAPI.openUrl(SELECTION_GITHUB_INSTALL_URL)}
            />
            <HeaderIconButton
              icon={<Unlink2 className="size-4" aria-hidden="true" />}
              aria-label={disconnectLabel}
              tooltip={disconnectLabel}
              disabled={busy}
              onClick={() => void update('disconnect')}
            />
          </>}
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
