import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ImageSupportMode } from '@config/model-image-support'

const MODES: ImageSupportMode[] = ['auto', 'on', 'off']

export function ImageSupportModeControl({
  modelName,
  value,
  learnedOff,
  disabled,
  onChange,
  onResetLearned,
}: {
  modelName: string
  value: ImageSupportMode
  learnedOff?: boolean
  disabled?: boolean
  onChange: (mode: ImageSupportMode) => void
  onResetLearned: () => void
}) {
  const { t } = useTranslation()
  const labels: Record<ImageSupportMode, string> = {
    auto: t('apiSetup.imageSupport.auto'),
    on: t('apiSetup.imageSupport.on'),
    off: t('apiSetup.imageSupport.off'),
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-normal text-muted-foreground">{t('apiSetup.imageSupport.label')}</span>
        <div role="radiogroup" aria-label={`${modelName}: ${t('apiSetup.imageSupport.label')}`} className="flex rounded-lg border border-border p-0.5">
          {MODES.map(mode => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={value === mode}
              disabled={disabled}
              onClick={() => onChange(mode)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
                value === mode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-foreground/5',
              )}
            >
              {labels[mode]}
            </button>
          ))}
        </div>
      </div>
      {value === 'auto' && learnedOff && (
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[11px] text-muted-foreground">{t('apiSetup.imageSupport.learnedOff')}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={onResetLearned}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            {t('apiSetup.imageSupport.resetLearned')}
          </button>
        </div>
      )}
    </div>
  )
}
