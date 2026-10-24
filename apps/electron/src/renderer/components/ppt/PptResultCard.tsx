import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Session } from '../../../shared/types'
import type { PptRevision } from '@craft-agent/shared/protocol'
import { usePptCatalog } from './usePptCatalog'
import { usePptRevisionSend } from './ppt-revision'

export function PptResultCard({ session }: { session: Session | null }) {
  const { t } = useTranslation()
  const send = usePptRevisionSend()
  const { catalog } = usePptCatalog()
  const [menu, setMenu] = useState<'restyle' | 'recolor' | null>(null)
  const progress = session?.pptProgress
  if (!send || !session?.ppt || session.isProcessing || progress?.generating || !(progress && progress.total > 0)) return null
  const submit = (text: string, revision: PptRevision) => {
    setMenu(null)
    void send(text, revision)
  }
  return <div data-testid="ppt-result-card" className="mx-auto mb-2 flex w-full max-w-[720px] flex-wrap items-center gap-2 rounded-xl bg-background px-3 py-2 shadow-minimal ring-1 ring-border/60">
    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">{progress.fileName ?? 'PPTX'}</span>
    <button type="button" className="rounded-md px-2.5 py-1 text-[13px] hover:bg-foreground/5" onClick={() => setMenu(menu === 'restyle' ? null : 'restyle')}>{t('ppt.result.restyle')}</button>
    <button type="button" className="rounded-md px-2.5 py-1 text-[13px] hover:bg-foreground/5" onClick={() => setMenu(menu === 'recolor' ? null : 'recolor')}>{t('ppt.result.recolor')}</button>
    {menu === 'restyle' && <div className="flex max-h-40 w-full flex-col overflow-auto rounded-md bg-foreground/[0.03] p-1">
      {catalog?.templates.map(template => <button key={template.id} type="button" className="truncate rounded px-2 py-1 text-left text-[12px] hover:bg-background" onClick={() => submit('换风格重排', { action: 'restyle', targets: [], templateId: template.id })}>{template.title}</button>)}
    </div>}
    {menu === 'recolor' && <div className="flex w-full flex-wrap gap-1.5 p-1">
      {catalog?.themes.map(theme => <button key={theme.id} type="button" className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] ring-1 ring-border hover:bg-foreground/5" onClick={() => submit('换配色', { action: 'recolor', targets: [], themeId: theme.id })}>
        <span className="size-3 rounded-full" style={{ background: theme.accent }} />{theme.name}
      </button>)}
    </div>}
  </div>
}
