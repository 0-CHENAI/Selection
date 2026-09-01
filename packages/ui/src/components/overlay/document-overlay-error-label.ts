export function documentOverlayErrorLabel(
  errorLabel?: string,
  typeBadgeLabel?: string,
): string {
  if (errorLabel) return errorLabel
  if (typeBadgeLabel === 'Write') return 'Write Failed'
  return 'Failed'
}
