import { ChevronRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

const pages = [
  ['settings.messaging.lark.guide.console', ''],
  ['settings.messaging.lark.guide.credentials', 'baseinfo'],
  ['settings.messaging.lark.guide.permissions', 'auth'],
  ['settings.messaging.lark.guide.events', 'event'],
] as const

export function LarkSetupGuide({ domain, appId }: { domain: 'feishu' | 'lark'; appId: string }) {
  const { t } = useTranslation()
  const consoleUrl = domain === 'feishu' ? 'https://open.feishu.cn/app' : 'https://open.larksuite.com/app'
  const id = appId.trim()
  const hasAppId = /^cli_[a-zA-Z0-9]+$/.test(id)

  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm py-1 hover:text-foreground focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {t('settings.messaging.lark.setupGuide')}
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 break-words pl-5 leading-relaxed">
        {pages.map(([key, page]) => (
          <li key={key}>
            <Trans i18nKey={key} components={{
              page: <a
                href={page && hasAppId ? `${consoleUrl}/${id}/${page}` : consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-current focus-visible:outline-ring"
              />,
            }} />
          </li>
        ))}
      </ol>
      {!hasAppId && <p className="mt-2 leading-relaxed">{t('settings.messaging.lark.guide.selectApp')}</p>}
    </details>
  )
}
