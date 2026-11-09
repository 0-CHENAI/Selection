import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatModelLimitCaption,
  PICKER_COLLAPSE_THRESHOLD,
  resolveVisiblePickerModels,
} from './model-picker-helpers'
import type { ModelDefinition } from '@config/models'

export function usePickerSearchQuery(resetKey: boolean): {
  query: string
  setQuery: (query: string) => void
} {
  const [query, setQuery] = React.useState('')
  React.useEffect(() => {
    if (!resetKey) setQuery('')
  }, [resetKey])
  return { query, setQuery }
}

export function useVisiblePickerModels(
  models: Array<ModelDefinition | string>,
  query: string,
  currentModel?: string,
  pinnedIds?: readonly string[],
) {
  return React.useMemo(
    () => resolveVisiblePickerModels(models, { query, currentModel, pinnedIds }),
    [models, query, currentModel, pinnedIds],
  )
}

export function shouldShowPickerSearch(
  modelCount: number,
  query: string,
): boolean {
  return modelCount > PICKER_COLLAPSE_THRESHOLD || query.trim().length > 0
}

export function ModelPickerSearchField({
  value,
  onChange,
  inputRef,
  className,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  inputRef?: React.Ref<HTMLInputElement>
  className?: string
  placeholder?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn('relative mb-1.5', className)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t('apiSetup.searchModels')}
        className={cn(
          'w-full h-8 pl-8 pr-3 text-sm rounded-md',
          'bg-foreground/5 border-0',
          'placeholder:text-muted-foreground/50',
          'focus:outline-none focus:ring-1 focus:ring-foreground/20',
        )}
      />
    </div>
  )
}

export function ModelPickerOverflowHint({
  hiddenCount,
  searching,
}: {
  hiddenCount: number
  searching: boolean
}) {
  const { t } = useTranslation()
  if (hiddenCount <= 0) return null
  return (
    <div className="px-2.5 py-2 text-xs text-muted-foreground select-none">
      {searching
        ? t('chat.modelPicker.refineSearch', { count: hiddenCount })
        : t('chat.modelPicker.searchMore', { count: hiddenCount })}
    </div>
  )
}

export function ModelPickerEmptyResults() {
  const { t } = useTranslation()
  return (
    <div className="px-2.5 py-3 text-sm text-muted-foreground text-center select-none">
      {t('chat.modelPicker.noResults')}
    </div>
  )
}

export function pickerModelLimitCaption(
  model: ModelDefinition | string,
  t: (key: string) => string,
): string | undefined {
  return formatModelLimitCaption(model, {
    context: t('chat.context'),
    output: t('chat.usage.output'),
  })
}
