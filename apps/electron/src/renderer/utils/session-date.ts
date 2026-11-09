import { format, isToday, isYesterday } from 'date-fns'
import { getDateLocale } from '@craft-agent/shared/i18n'

type DateGroupTranslator = (key: 'common.today' | 'common.yesterday') => string

/** Format a session-list date group for the active UI language. */
export function formatSessionDateGroupLabel(
  date: Date,
  t: DateGroupTranslator,
  language: string,
): string {
  if (isToday(date)) return t('common.today')
  if (isYesterday(date)) return t('common.yesterday')

  const [baseLanguage] = language.toLowerCase().split('-')
  const pattern = baseLanguage === 'zh' || baseLanguage === 'ja'
    ? 'M月d日'
    : 'MMM d'

  return format(date, pattern, { locale: getDateLocale(language) })
}
