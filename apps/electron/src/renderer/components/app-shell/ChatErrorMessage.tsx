import { isTerminalResponseError } from '@/utils/terminal-error'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { ResponseActionRow, TurnRetryButton } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { AnimatedCollapsibleContent } from '@/components/ui/collapsible'
import type { Message } from '../../../shared/types'
import { handleErrorMessageAction } from './error-message-actions'
import { ContextLimitRecoveryActions, type ContextLimitRecoveryOptions } from './ContextLimitRecoveryActions'
import { ExecutionRecoveryStatus } from './ExecutionRecoveryStatus'

/**
 * Error message bubble. The failure text stays in the card; retry sits in the
 * same bottom action row as regenerate on a completed assistant reply.
 */
export function ErrorMessage({
  message,
  onOpenUrl,
  sessionId,
  onRetry,
  contextRecovery,
  executionRecovery,
  compactMode = false,
}: {
  message: Message
  onOpenUrl?: (url: string) => void
  sessionId?: string
  onRetry?: () => void
  contextRecovery?: ContextLimitRecoveryOptions
  executionRecovery?: React.ComponentProps<typeof ExecutionRecoveryStatus>
  compactMode?: boolean
}) {
  const { t } = useTranslation()
  const terminalCode = isTerminalResponseError(message.errorCode) ? message.errorCode : undefined
  const hasDetails = executionRecovery || (message.errorDetails && message.errorDetails.length > 0) || message.errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const detailsId = React.useId()
  const reduceMotion = useReducedMotion()
  const actions = message.errorActions?.filter(a => {
    if (a.action === 'retry' && (terminalCode || message.errorCanRetry === false)) return false
    if (a.action === 'open_url') return !!a.url && !!onOpenUrl
    return true
  })
  const retryActions = actions?.filter(action => action.action === 'retry') ?? []
  const otherActions = actions?.filter(action => action.action !== 'retry') ?? []

  const detailsContent = <div className="mt-2 pt-2 border-t border-destructive/20 space-y-3">
    {executionRecovery && <ExecutionRecoveryStatus {...executionRecovery} />}
    <div className="text-xs text-destructive/60 font-mono space-y-0.5">
      {message.errorDetails?.map((detail, i) => <div key={i}>{detail}</div>)}
      {message.errorOriginal && !message.errorDetails?.some(d => d.includes('Raw error:')) && <div className="mt-1">Raw: {message.errorOriginal.slice(0, 200)}{message.errorOriginal.length > 200 ? '...' : ''}</div>}
    </div>
  </div>

  return (
    <div className="mt-4">
      {/* Subtle bg (3% opacity) + tinted shadow for softer error appearance */}
      <div className="flex justify-start">
        <div
          className="max-w-[80%] shadow-tinted rounded-[8px] pl-5 pr-4 pt-2 pb-2.5 break-words"
          style={{
            backgroundColor: terminalCode === 'context_limit' ? 'oklch(from var(--info) l c h / 0.03)' : 'oklch(from var(--destructive) l c h / 0.03)',
            '--shadow-color': terminalCode === 'context_limit' ? 'var(--info-rgb)' : 'var(--destructive-rgb)',
          } as React.CSSProperties}
        >
          <div className={cn('text-xs mb-0.5 font-semibold', terminalCode === 'context_limit' ? 'flex items-center gap-1.5 text-foreground' : 'text-destructive/50')}>
            {terminalCode === 'context_limit' && <AlertTriangle aria-hidden="true" className="size-3.5 text-info" />}
            {terminalCode ? t(`chat.terminal.${terminalCode}.title`) : message.errorTitle || t('common.error')}
          </div>
          <p className={cn('text-sm', terminalCode === 'context_limit' ? 'text-foreground/80' : 'text-destructive')}>{terminalCode ? t(`chat.terminal.${terminalCode}.message`) : message.content}</p>
          {terminalCode === 'context_limit' && contextRecovery && <ContextLimitRecoveryActions {...contextRecovery} />}

          {otherActions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {otherActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => {
                    handleErrorMessageAction(action, {
                      sessionId,
                      onOpenUrl,
                      onRetry,
                    })
                  }}
                  className="text-xs px-2 py-0.5 rounded border border-destructive/20 text-destructive/70 hover:text-destructive hover:border-destructive/40 transition-colors"
                >
                  {action.label}{action.action === 'open_url' ? ' ↗' : ''}
                </button>
              ))}
            </div>
          )}

          {hasDetails && (
            <div className="mt-2">
              <button
                type="button"
                aria-expanded={detailsOpen}
                aria-controls={detailsId}
                onClick={() => setDetailsOpen(!detailsOpen)}
                className="flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive transition-colors"
              >
                {detailsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span>{detailsOpen ? t('chat.hideTechnicalDetails') : t('chat.showTechnicalDetails')}</span>
              </button>

              <div id={detailsId} aria-hidden={!detailsOpen}>
                {reduceMotion ? detailsOpen && detailsContent : <AnimatedCollapsibleContent isOpen={detailsOpen} className="overflow-hidden">{detailsContent}</AnimatedCollapsibleContent>}
              </div>
            </div>
          )}
        </div>
      </div>
      {retryActions.length > 0 && (
        <ResponseActionRow compact={compactMode}>
          <div className="flex shrink-0 items-center gap-3">
            {retryActions.map((action) => (
              <TurnRetryButton
                key={action.key}
                label={t('common.retry')}
                onClick={() => {
                  handleErrorMessageAction(action, {
                    sessionId,
                    onOpenUrl,
                    onRetry,
                  })
                }}
              />
            ))}
          </div>
        </ResponseActionRow>
      )}
    </div>
  )
}
