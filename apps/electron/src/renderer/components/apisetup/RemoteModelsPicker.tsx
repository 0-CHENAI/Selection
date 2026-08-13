import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Command as CommandPrimitive } from 'cmdk'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import type { RemoteModel } from './fetch-openai-models.ts'
import { parseSelectedModels } from './fetch-openai-models.ts'

interface RemoteModelsPickerProps {
  models: RemoteModel[]
  value: string
  loading: boolean
  disabled?: boolean
  error?: string | null
  hint?: string
  waitingForKey?: boolean
  onToggle: (id: string) => void
  onRetry?: () => void
}

export function RemoteModelsPicker({
  models,
  value,
  loading,
  disabled,
  error,
  hint,
  waitingForKey,
  onToggle,
  onRetry,
}: RemoteModelsPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => parseSelectedModels(value), [value])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) =>
      m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    )
  }, [models, filter])

  const summary = selected.length > 0
    ? selected.join(', ')
    : waitingForKey
      ? t('apiSetup.enterKeyToLoadModels')
      : t('apiSetup.selectModel')

  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground font-normal">
        {t('apiSetup.defaultModel')}{' '}
        <span className="text-foreground/30">· {t('apiSetup.required')}</span>
      </Label>

      {loading ? (
        <div className="flex h-9 items-center gap-2 rounded-md bg-foreground-2 px-3 text-muted-foreground shadow-minimal">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="text-xs">{t('apiSetup.loadingModels')}</span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || waitingForKey || models.length === 0}
          onClick={(e) => {
            if (open) {
              setOpen(false)
              setFilter('')
              return
            }
            const rect = e.currentTarget.getBoundingClientRect()
            setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
            setOpen(true)
            setFilter('')
            setTimeout(() => filterRef.current?.focus(), 0)
          }}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md px-3 text-sm',
            'bg-foreground-2 shadow-minimal transition-colors text-left',
            'hover:bg-background focus:outline-none focus:bg-background',
            (disabled || waitingForKey || models.length === 0) && 'opacity-50 pointer-events-none',
          )}
        >
          <span className={cn('truncate', selected.length === 0 && 'text-muted-foreground')}>
            {summary}
          </span>
          <ChevronDown className="size-3 opacity-50 shrink-0" />
        </button>
      )}

      {open && menuPos && (
        <>
          <div
            className="fixed inset-0 z-floating-backdrop"
            onClick={() => { setOpen(false); setFilter('') }}
          />
          <div
            className="fixed z-floating-menu min-w-[200px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            <CommandPrimitive shouldFilter={false}>
              <div className="border-b border-border/50 px-3 py-2">
                <CommandPrimitive.Input
                  ref={filterRef}
                  value={filter}
                  onValueChange={setFilter}
                  placeholder={t('apiSetup.searchModels')}
                  autoFocus
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground placeholder:select-none"
                />
              </div>
              <CommandPrimitive.List className="max-h-[240px] overflow-y-auto p-1">
                {filtered.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {t('apiSetup.noModels')}
                  </div>
                ) : (
                  filtered.map((model) => {
                    const isOn = selectedSet.has(model.id)
                    return (
                      <CommandPrimitive.Item
                        key={model.id}
                        value={model.id}
                        onSelect={() => {
                          onToggle(model.id)
                          setOpen(false)
                          setFilter('')
                        }}
                        className={cn(
                          'flex cursor-pointer select-none items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-[13px]',
                          'outline-none data-[selected=true]:bg-foreground/5',
                        )}
                      >
                        <span className="truncate">{model.name}</span>
                        <Check className={cn('size-3 shrink-0', isOn ? 'opacity-100' : 'opacity-0')} />
                      </CommandPrimitive.Item>
                    )
                  })
                )}
              </CommandPrimitive.List>
            </CommandPrimitive>
          </div>
        </>
      )}

      {error && (
        <p className="text-xs text-destructive">
          {error}
          {onRetry && (
            <>
              {' '}
              <button type="button" className="underline" onClick={onRetry}>
                {t('apiSetup.retryLoadModels')}
              </button>
            </>
          )}
        </p>
      )}
      {hint && !error && (
        <p className="text-xs text-foreground/30">{hint}</p>
      )}
    </div>
  )
}
