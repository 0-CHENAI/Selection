/**
 * Shared authentication validation utilities
 * Used by both CredentialRequest and AuthRequestCard components
 */

/**
 * Validate basic auth credentials based on whether password is required
 *
 * @param username - The username/API key value
 * @param password - The password value
 * @param passwordRequired - Whether password field is required (defaults to true for backward compatibility)
 * @returns true if credentials are valid, false otherwise
 */
export function validateBasicAuthCredentials(
  username: string,
  password: string,
  passwordRequired: boolean = true
): boolean {
  const hasUsername = username.trim().length > 0
  const hasPassword = password.trim().length > 0

  return passwordRequired
    ? hasUsername && hasPassword  // Both required
    : hasUsername                  // Only username required
}

/**
 * Get the password value to submit based on whether it's required
 * When password is not required, always submit empty string regardless of field content
 *
 * @param password - The password field value
 * @param passwordRequired - Whether password is required
 * @returns The password value to submit (trimmed or empty string)
 */
export function getPasswordValue(
  password: string,
  passwordRequired: boolean = true
): string {
  return passwordRequired ? password.trim() : ''
}

/**
 * Get the password label with optional suffix
 *
 * @param baseLabel - The base label (e.g., "Password")
 * @param passwordRequired - Whether password is required
 * @param optionalSuffix - Localized " (optional)" suffix when not required
 * @returns The label with optional suffix if not required
 */
export function getPasswordLabel(
  baseLabel: string,
  passwordRequired: boolean = true,
  optionalSuffix: string = ' (optional)',
): string {
  return passwordRequired ? baseLabel : `${baseLabel}${optionalSuffix}`
}

/**
 * Get the password placeholder text
 *
 * @param baseLabel - The base label (e.g., "Password")
 * @param passwordRequired - Whether password is required
 * @param enterLabel - Localized "Enter {{label}}" template or resolved string
 * @param optionalPlaceholder - Localized optional placeholder when not required
 * @returns Appropriate placeholder text
 */
export function getPasswordPlaceholder(
  baseLabel: string,
  passwordRequired: boolean = true,
  enterLabel?: string,
  optionalPlaceholder: string = 'Optional - leave blank',
): string {
  return passwordRequired
    ? (enterLabel ?? `Enter ${baseLabel.toLowerCase()}`)
    : optionalPlaceholder
}
