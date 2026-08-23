/**
 * SettingsMenuSelect
 *
 * Menu-style dropdown select with support for option descriptions.
 * Uses Radix Popover for collision detection and accessibility.
 * Includes search/filter when options exceed threshold.
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { settingsUI } from './SettingsUIConstants'
import {
  PICKER_COLLAPSE_THRESHOLD,
  PICKER_SEARCH_RESULT_LIMIT,
} from '@/components/app-shell/input/model-picker-helpers'
import {
  ModelPickerEmptyResults,
  ModelPickerOverflowHint,
  ModelPickerSearchField,
} from '@/components/app-shell/input/ModelPickerSearch'

export interface SettingsMenuSelectOption {
  /** Value for this option */
  value: string
  /** Display label */
  label: string
  /** Optional description/subtitle */
  description?: string
}

export interface SettingsMenuSelectProps {
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder when nothing selected */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className for trigger */
  className?: string
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
  /** Values kept in the idle preview when the catalog is collapsed */
  pinnedValues?: string[]
}

/**
 * SettingsMenuSelect - Menu-style dropdown with descriptions
 *
 * Uses Radix Popover for automatic collision detection and positioning.
 * Trigger styled like the model selector in FreeFormInput.
 * Includes search filter when options exceed 8 or searchable prop is true.
 */
export function SettingsMenuSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
  pinnedValues,
}: SettingsMenuSelectProps) {
  const { t } = useTranslation()
  const effectiveSearchPlaceholder = searchPlaceholder ?? t("common.search")
  const [isOpen, setIsOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  const showSearch = searchable ?? (options.length > 8)
  const searching = searchQuery.trim().length > 0

  const filteredOptions = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (query) {
      return options.filter(
        (option) =>
          option.label.toLowerCase().includes(query) ||
          option.value.toLowerCase().includes(query) ||
          option.description?.toLowerCase().includes(query)
      )
    }

    if (options.length <= PICKER_COLLAPSE_THRESHOLD) return options

    const pinOrder: string[] = []
    const addPin = (id?: string) => {
      if (!id || pinOrder.includes(id)) return
      pinOrder.push(id)
    }
    addPin(value)
    for (const id of pinnedValues ?? []) addPin(id)

    return pinOrder
      .map((id) => options.find((option) => option.value === id))
      .filter((option): option is SettingsMenuSelectOption => option != null)
  }, [options, searchQuery, value, pinnedValues])

  const hiddenCount = searching
    ? Math.max(0, filteredOptions.length - PICKER_SEARCH_RESULT_LIMIT)
    : Math.max(0, options.length - filteredOptions.length)
  const visibleOptions = searching
    ? filteredOptions.slice(0, PICKER_SEARCH_RESULT_LIMIT)
    : filteredOptions

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchQuery('')
    // Clear preview on selection since the actual value is now set
    onHover?.(null)
  }

  // Clear preview when popover closes (via click outside, escape, etc.)
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      onHover?.(null)
      setSearchQuery('')
    } else if (showSearch) {
      // Focus search input when opening
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'inline-flex items-center h-8 px-3 gap-1 text-sm rounded-lg',
            'bg-background shadow-minimal',
            'hover:bg-foreground/[0.02] transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOpen && 'bg-foreground/[0.02]',
            className
          )}
        >
          <span className="truncate">{selectedOption?.label || placeholder}</span>
          <ChevronDown className="opacity-50 shrink-0 size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="p-1.5"
        style={{ width: menuWidth }}
        onMouseLeave={() => onHover?.(null)}
      >
        {showSearch && (
          <ModelPickerSearchField
            value={searchQuery}
            onChange={setSearchQuery}
            inputRef={searchInputRef}
            placeholder={effectiveSearchPlaceholder}
          />
        )}
        <div className="space-y-0.5 max-h-64 overflow-auto">
          {visibleOptions.length === 0 ? (
            <ModelPickerEmptyResults />
          ) : (
            visibleOptions.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => onHover?.(option.value)}
                  className={cn(
                    'w-full flex items-center justify-between px-2.5 py-2 rounded-lg',
                    'hover:bg-foreground/5 transition-colors text-left',
                    isSelected && 'bg-foreground/3'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className={settingsUI.label}>{option.label}</div>
                    {option.description && (
                      <div className={cn(settingsUI.descriptionSmall, settingsUI.labelDescriptionGap)}>
                        {option.description}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="size-4 text-foreground shrink-0 ml-3" />
                  )}
                </button>
              )
            })
          )}
          <ModelPickerOverflowHint hiddenCount={hiddenCount} searching={searching} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * SettingsMenuSelectRow - Inline row with label and menu select
 */
export interface SettingsMenuSelectRowProps {
  /** Row label */
  label: string
  /** Optional description below label */
  description?: string
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
  /** Values kept in the idle preview when the catalog is collapsed */
  pinnedValues?: string[]
}

export function SettingsMenuSelectRow({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  inCard = true,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
  pinnedValues,
}: SettingsMenuSelectRowProps) {
  return (
    <div
      data-layout="settings-row"
      className={cn(
        'flex items-center justify-between',
        inCard ? 'px-4 py-3.5' : 'py-3',
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className={settingsUI.label}>{label}</div>
        {description && (
          <p className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
        )}
      </div>
      <div data-layout="settings-control" className="ml-4 shrink-0">
        <SettingsMenuSelect
          value={value}
          onValueChange={onValueChange}
          options={options}
          placeholder={placeholder}
          disabled={disabled}
          menuWidth={menuWidth}
          onHover={onHover}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          pinnedValues={pinnedValues}
        />
      </div>
    </div>
  )
}
