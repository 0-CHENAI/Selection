import { useTranslation } from 'react-i18next'
import { UserMessageBubble } from '@craft-agent/ui'
import { CHAT_LAYOUT } from '@/config/layout'
import type { Session } from '../../../shared/types'

export function HandoverMessageBubble({ session, compactMode = false }: { session: Session; compactMode?: boolean }) {
  // The persisted input receipt exists only after the target background was applied.
  // Keep it as an internal info message; only its presentation uses the user bubble.
  const receipt = session.handover && session.messages.find(message =>
    message.id === `handover-${session.handover!.handoverId}` && message.role === 'info',
  )
  const { t } = useTranslation()
  if (!receipt || !session.workMode) return null
  return (
    <div data-handover-message className={compactMode ? 'pt-2 pb-1' : CHAT_LAYOUT.userMessagePadding}>
      <UserMessageBubble content={t('handover.success', { mode: session.workMode })}
        timestamp={receipt.timestamp} compactMode={compactMode} />
    </div>
  )
}
