/**
 * Matcher fields accepted only while reading older automation resources.
 * Validation ignores these keys so retired integrations do not prevent an
 * otherwise valid resource bundle from loading.
 */
export const LEGACY_AUTOMATION_MATCHER_FIELDS = ['telegramTopic'] as const
