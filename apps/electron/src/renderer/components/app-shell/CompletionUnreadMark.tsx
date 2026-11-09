import { Spinner } from '@craft-agent/ui'
import { useTranslation } from 'react-i18next'

/** Persistent attention cue, independent of row hover and selection. */
export function CompletionUnreadMark() {
  const { t } = useTranslation()
  return <span className="inline-flex shrink-0 items-center" title={t('session.unreadIndicator')}>
    <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
    <span className="sr-only">{t('session.unreadIndicator')}</span>
  </span>
}

/** Reuse the same animation and size as SessionItem's processing indicator. */
export function SessionRunningMark() {
  const { t } = useTranslation()
  return <span className="inline-flex shrink-0 items-center" title={t('turnCard.processing')}>
    <Spinner className="text-[10px]" />
    <span className="sr-only">{t('turnCard.processing')}</span>
  </span>
}
