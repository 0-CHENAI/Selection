export function documentOverlayErrorLabel(
  errorLabel?: string,
  typeBadgeLabel?: string,
): string {
  if (errorLabel) return errorLabel
  if (typeBadgeLabel === 'Write') return 'Write Failed'
  return 'Failed'
}

/** Hide the markdown body when it repeats the error banner verbatim. */
export function overlayBodyDuplicatesError(content: string, error?: string): boolean {
  const errorMessage = error?.trim()
  if (!errorMessage) return false
  const body = content.trim()
  return body.length === 0 || body === errorMessage
}
