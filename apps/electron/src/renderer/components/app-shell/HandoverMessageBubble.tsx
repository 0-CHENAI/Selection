import { useTranslation } from 'react-i18next'
import { ResponseCard } from '@craft-agent/ui'
import type { Session } from '../../../shared/types'

export function HandoverMessageBubble({ session, compactMode = false }: { session: Session; compactMode?: boolean }) {
  // The persisted input receipt exists only after the target background was applied.
  // Keep it as an internal info message; only its presentation uses the Agent response card.
  const receipt = session.handover && session.messages.find(message =>
    message.id === `handover-${session.handover!.handoverId}` && message.role === 'info',
  )
  const { t } = useTranslation()
  if (!receipt || !session.workMode) return null
  return (
    <div data-handover-message className="pt-2">
      <ResponseCard text={t('handover.success', { mode: session.workMode })} isStreaming={false}
        isTurnComplete sessionId={session.id} messageId={receipt.id} compactMode={compactMode} />
    </div>
  )
}
