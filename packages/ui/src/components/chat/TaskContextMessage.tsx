import type { Message } from '@craft-agent/core'
import { useTranslation } from 'react-i18next'
import { UserMessageBubble, type UserMessageBubbleProps } from './UserMessageBubble'

/** Host context has a readable transcript presentation; the original protocol is available on demand. */
export function TaskContextMessage({ message, onFileClick, onUrlClick }: {
  message: Message & { taskContext: NonNullable<Message['taskContext']> }
} & Pick<UserMessageBubbleProps, 'onFileClick' | 'onUrlClick'>) {
  const { t } = useTranslation()
  const context = message.taskContext
  return (
    <article className="min-w-0 py-1 text-[13px] text-foreground/60" data-task-context={context.kind}>
      <p className="text-foreground/80">
        {t(`chat.taskContext.${context.kind}.title`)}{context.title && <> · {context.title}</>}
      </p>
      {!!message.attachments?.length && <UserMessageBubble content="" attachments={message.attachments} onFileClick={onFileClick} onUrlClick={onUrlClick} />}
      {context.description && <p className="mt-1 whitespace-pre-wrap break-words text-foreground/80">{context.description}</p>}
      <p className="mt-1 text-foreground/60">{t(`chat.taskContext.${context.kind}.description`)}</p>
      <details className="mt-2 text-xs text-foreground/60">
        <summary className="w-fit cursor-pointer rounded-sm outline-offset-4 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none">{t('chat.taskContext.originalRecord')}</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-foreground/3 p-3 text-xs text-foreground/80">{message.content}</pre>
      </details>
    </article>
  )
}
