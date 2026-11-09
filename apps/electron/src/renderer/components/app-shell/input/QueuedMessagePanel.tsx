import * as React from 'react'
import { Check, GripVertical, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { SortableList } from '@/components/ui/sortable-list'
import type { Message } from '../../../../shared/types'

export function queuedMessageCommandId(message: Message): string | null {
  if (message.queueId) return message.queueId
  return message.isPending ? null : message.id
}

export function queuedMessageCommandIds(messages: Message[]): string[] | null {
  const ids = messages.map(queuedMessageCommandId)
  return ids.some(id => !id) ? null : ids as string[]
}

interface QueuedMessagePanelProps {
  sessionId: string
  messages: Message[]
  compactMode?: boolean
}

export function QueuedMessagePanel({
  sessionId,
  messages,
  compactMode = false,
}: QueuedMessagePanelProps) {
  const { t } = useTranslation()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const editTriggerRef = React.useRef<HTMLButtonElement | null>(null)

  const runCommand = React.useCallback(async (
    itemId: string,
    command: Parameters<typeof window.electronAPI.sessionCommand>[1],
  ) => {
    setBusyId(itemId)
    try {
      await window.electronAPI.sessionCommand(sessionId, command)
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      toast.error(t('chat.queue.actionFailed'), {
        description: detail === 'SEND_QUEUED_NOW_UNAVAILABLE'
          ? t('chat.queue.sendNowUnavailable')
          : detail,
      })
      return false
    } finally {
      setBusyId(null)
    }
  }, [sessionId, t])

  const closeEditor = React.useCallback(() => {
    setEditingId(null)
    setDraft('')
    requestAnimationFrame(() => editTriggerRef.current?.focus())
  }, [])

  const saveEdit = React.useCallback(async (message: Message) => {
    const commandId = queuedMessageCommandId(message)
    const content = draft.trim()
    if (!commandId || !content) return

    const saved = await runCommand(commandId, {
      type: 'updateQueuedMessage',
      messageId: commandId,
      content,
    })
    if (saved) closeEditor()
  }, [closeEditor, draft, runCommand])

  const handleReorder = React.useCallback((orderedMessages: Message[]) => {
    const messageIds = queuedMessageCommandIds(orderedMessages)
    if (!messageIds) return
    void runCommand('queue-order', {
      type: 'reorderQueuedMessages',
      messageIds,
    })
  }, [runCommand])

  if (messages.length === 0) return null

  return (
    <section
      aria-label={t('chat.queue.label', { count: messages.length })}
      className="mb-2 overflow-hidden rounded-[10px] bg-foreground/[0.035]"
    >
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span aria-live="polite">{t('chat.queue.label', { count: messages.length })}</span>
        <span>{t('chat.queue.waiting')}</span>
      </div>

      <SortableList
        items={messages}
        onReorder={handleReorder}
        handleOnly
        className={cn('overflow-y-auto', compactMode ? 'max-h-[32vh]' : 'max-h-56')}
        renderItem={(message, isDragging, dragHandleProps) => {
          const index = messages.findIndex(candidate => candidate.id === message.id)
          const commandId = queuedMessageCommandId(message)
          const isEditing = editingId === message.id
          const isBusy = busyId === commandId || busyId === 'queue-order' || !commandId
          const metadata = [
            ...(message.attachments?.length
              ? [{ kind: 'attachments' as const, label: String(message.attachments.length) }]
              : []),
            ...(message.badges?.map(badge => ({ kind: 'badge' as const, label: badge.label })) ?? []),
            ...(message.queuedContext?.model
              ? [{ kind: 'context' as const, label: message.queuedContext.model }]
              : []),
            ...(message.queuedContext?.sourceSlugs.length
              ? [{
                  kind: 'context' as const,
                  label: t('chat.sourcesCount', { count: message.queuedContext.sourceSlugs.length }),
                }]
              : []),
          ]

          return (
            <div
              className={cn(
                'border-t border-foreground/[0.06] px-2 py-2',
                isDragging && 'bg-foreground/[0.04]',
              )}
              aria-label={t('chat.queue.itemPosition', {
                position: index + 1,
                count: messages.length,
              })}
            >
              {isEditing ? (
                <div className="flex items-end gap-2">
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        closeEditor()
                      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        void saveEdit(message)
                      }
                    }}
                    rows={2}
                    aria-label={t('chat.queue.edit')}
                    className="min-h-14 flex-1 resize-none rounded-[7px] bg-background px-2.5 py-2 text-sm outline-none ring-1 ring-border/50 focus:ring-foreground/25"
                  />
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={closeEditor}
                      aria-label={t('common.cancel')}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveEdit(message)}
                      disabled={!draft.trim() || isBusy}
                      aria-label={t('common.save')}
                      className="rounded-md p-1.5 text-foreground hover:bg-foreground/[0.06] disabled:opacity-30"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {dragHandleProps ? (
                    <button
                      {...dragHandleProps}
                      type="button"
                      disabled={busyId !== null || !commandId}
                      aria-label={t('chat.queue.dragHandle')}
                      className="shrink-0 cursor-grab rounded p-1 text-muted-foreground/45 hover:bg-foreground/[0.05] hover:text-muted-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-25"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="shrink-0 p-1 text-muted-foreground/45">
                      <GripVertical className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground/80">{message.content}</p>
                    {metadata.length > 0 && (
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/60">
                        {metadata.slice(0, 3).map((item, metadataIndex) => (
                          <span key={`${item.kind}-${metadataIndex}`} className="flex min-w-0 items-center gap-0.5 truncate">
                            {item.kind === 'attachments' && <Paperclip className="h-2.5 w-2.5" />}
                            <span className="truncate">{item.label}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        editTriggerRef.current = event.currentTarget
                        setEditingId(message.id)
                        setDraft(message.content)
                      }}
                      disabled={isBusy}
                      aria-label={t('chat.queue.edit')}
                      className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-25"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => commandId && void runCommand(commandId, {
                        type: 'deleteQueuedMessage',
                        messageId: commandId,
                      })}
                      disabled={isBusy}
                      aria-label={t('chat.queue.delete')}
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/[0.08] hover:text-destructive disabled:opacity-25"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => commandId && void runCommand(commandId, {
                        type: 'sendQueuedMessageNow',
                        messageId: commandId,
                      })}
                      disabled={isBusy}
                      aria-label={t('chat.queue.sendNow')}
                      className="ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground disabled:opacity-25"
                    >
                      <Send className="h-3 w-3" />
                      <span className={compactMode ? 'sr-only' : undefined}>{t('chat.queue.sendNow')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        }}
      />
    </section>
  )
}
