import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import { handoverSuccessAtom } from '@/atoms/handover'
import { Info_Alert } from '@/components/info/Info_Alert'

export function HandoverSuccessAlert({ sessionId, active = true }: { sessionId: string; active?: boolean }) {
  const { t } = useTranslation()
  const [notice, setNotice] = useAtom(handoverSuccessAtom)
  const [visible, setVisible] = useState<typeof notice>(null)
  useEffect(() => {
    if (!active || notice?.sessionId !== sessionId) return
    if (notice.expiresAt > Date.now()) setVisible(notice)
    setNotice(current => current === notice ? null : current)
  }, [notice, sessionId, active, setNotice])
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setVisible(null), 2000)
    return () => clearTimeout(timer)
  }, [visible])
  if (!visible || visible.sessionId !== sessionId) return null

  return <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4">
    <div key={visible.expiresAt} data-handover-success
      className="max-w-full animate-[handover-success_2s_ease-out_both] motion-reduce:animate-none">
      <Info_Alert variant="success" inline role="status" aria-live="polite" aria-atomic="true"
        icon={<CheckCircle2 aria-hidden="true" className="size-4 text-success" />}
        className="border-success/25 bg-[color-mix(in_oklab,var(--success)_12%,var(--background))] text-[var(--success-text)]">
        <Info_Alert.Title>{t('handover.success', { mode: visible.mode })}</Info_Alert.Title>
      </Info_Alert>
    </div>
  </div>
}
