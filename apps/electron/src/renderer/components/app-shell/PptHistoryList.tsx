import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Plus, Presentation } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@craft-agent/shared/i18n'
import type { SessionMeta } from '@/atoms/sessions'
import { groupPptHistory } from '@/components/ppt/history'
import { usePptCatalog } from '@/components/ppt/usePptCatalog'
import { Button } from '@/components/ui/button'
import { useFocusContext } from '@/context/FocusContext'
import { useFocusZone, useRovingTabIndex } from '@/hooks/keyboard'
import { cn } from '@/lib/utils'
import { SessionSearchHeader } from './SessionSearchHeader'

export function PptHistoryList({ items, selectedSessionId, onSelect, onNew }: {
  items: SessionMeta[]
  selectedSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = React.useState('')
  const { catalog } = usePptCatalog()
  const templates = React.useMemo(() => new Map(catalog?.templates.map(template => [template.id, template])), [catalog])
  const visible = React.useMemo(() => items.filter(item =>
    `${item.name ?? ''} ${item.preview ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ).sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0)), [items, query])
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [isSearchFocused, setIsSearchFocused] = React.useState(false)
  const { focusZone } = useFocusContext()
  const focusFirst = React.useCallback(() => {
    const row = listRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
    if (row) {
      row.focus()
      row.scrollIntoView({ block: 'nearest' })
    } else {
      searchInputRef.current?.focus()
    }
  }, [])
  const { zoneRef, isFocused } = useFocusZone({ zoneId: 'navigator', focusFirst })
  const keyboard = useRovingTabIndex({
    items: visible,
    getId: item => item.id,
    enabled: isFocused || isSearchFocused,
    moveFocus: !isSearchFocused,
    onNavigate: item => {
      onSelect(item.id)
      document.getElementById(`item-${item.id}`)?.scrollIntoView({ block: 'nearest' })
    },
    onActivate: item => {
      onSelect(item.id)
      focusZone('chat', { intent: 'keyboard' })
    },
  })
  const { setActiveIndex } = keyboard
  React.useEffect(() => {
    const index = visible.findIndex(item => item.id === selectedSessionId)
    setActiveIndex(index >= 0 ? index : 0)
  }, [visible, selectedSessionId, setActiveIndex])
  React.useEffect(() => {
    if (selectedSessionId) {
      document.getElementById(`item-${selectedSessionId}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedSessionId, visible])
  const indices = React.useMemo(() => new Map(visible.map((item, index) => [item.id, index])), [visible])
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
      focusZone('navigator', { intent: 'keyboard' })
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
      keyboard.getContainerProps().onKeyDown(event)
    }
  }
  const grouped = groupPptHistory(visible)
  const groups = [
    { label: t('ppt.recent'), items: grouped.recent },
    { label: t('ppt.thisWeek'), items: grouped.thisWeek },
    { label: t('ppt.earlier'), items: grouped.earlier },
  ]

  return <div ref={zoneRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col" data-testid="ppt-history">
    <SessionSearchHeader searchQuery={query} onSearchChange={setQuery} placeholder={t('ppt.searchHistory')} resultCount={visible.length} inputRef={searchInputRef} onKeyDown={handleSearchKeyDown} onFocus={() => { setIsSearchFocused(true); focusZone('navigator', { intent: 'click', moveFocus: false }) }} onBlur={() => setIsSearchFocused(false)} />
    {items.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-foreground/4 text-muted-foreground"><Presentation className="size-6" strokeWidth={1.5} /></div>
      <p className="text-sm font-medium">{t('ppt.emptyTitle')}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('ppt.emptyDescription')}</p>
      <Button type="button" variant="ghost" onClick={onNew} className="mt-4 h-8 gap-1.5 rounded-[6px] bg-background px-3 text-[13px] shadow-minimal"><Plus className="size-3.5" />{t('ppt.new')}</Button>
    </div> : <div ref={listRef} role="listbox" aria-label={t('ppt.searchHistory')} className="min-h-0 flex-1 overflow-y-auto pb-4">
      {visible.length === 0 && <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t('ppt.noSearchResults')}</p>}
      {groups.filter(group => group.items.length > 0).map(group => <section key={group.label}>
        <div className="px-4 pb-1 pt-3 text-[11px] font-medium tracking-wider text-muted-foreground">{group.label}</div>
        {group.items.map(item => {
          const template = item.ppt?.templateId ? templates.get(item.ppt.templateId) : undefined
          const selected = item.id === selectedSessionId
          const timestamp = item.lastMessageAt ?? item.createdAt
          return <div key={item.id} className="relative mr-2 pl-2">
            {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
            <button {...keyboard.getItemProps(item, indices.get(item.id)!)} type="button" onKeyDown={event => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                event.stopPropagation()
                focusZone(event.key === 'ArrowLeft' ? 'sidebar' : 'chat', { intent: 'keyboard' })
              } else {
                keyboard.getItemProps(item, indices.get(item.id)!).onKeyDown(event)
              }
            }} onClick={() => { focusZone('navigator', { intent: 'click', moveFocus: false }); onSelect(item.id) }} aria-selected={selected} aria-current={selected ? 'page' : undefined} className={cn('flex w-full items-center gap-3 rounded-lg py-2.5 pl-2 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'bg-foreground/3' : 'hover:bg-foreground/2')}>
              <span title={template ? t('ppt.referenceTemplate', { title: template.title }) : undefined} className="relative flex h-[38px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-foreground/5 shadow-minimal">
                {template ? <img src={template.cover} alt={t('ppt.referenceCover')} className="h-full w-full object-cover" /> : <Presentation className="size-5 text-muted-foreground" />}
                {item.isProcessing && <span className="absolute inset-0 flex items-center justify-center bg-background/55 backdrop-blur-[1px]"><LoaderCircle className="size-3.5 animate-spin text-accent motion-reduce:animate-none" /></span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13px]', item.isProcessing && 'animate-shimmer-text')}>{item.name || item.preview || t('ppt.new')}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.isProcessing ? t('ppt.generating') : template ? t('ppt.pages', { count: template.pages }) : 'PPTX'}</span>
              </span>
              {timestamp && <span className="self-start whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground">{formatDistanceToNow(timestamp, { locale: getDateLocale(i18n.language), addSuffix: false })}</span>}
            </button>
          </div>
        })}
      </section>)}
    </div>}
  </div>
}
