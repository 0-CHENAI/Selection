/**
 * Values passed into the settings API setup form.
 *
 * Adding a connection starts on the welcome cards. ORDER's card stores a
 * prefill (preset + gateway URL) on the onboarding hook. Direct edit of an
 * existing connection skips those cards and must keep the saved values.
 * A previous edit must not leak into a new setup: the alphabetical default
 * preset is Amazon Bedrock, which is what users saw after #527 when the
 * ORDER prefill never reached this form.
 */
export function resolveSettingsApiSetupInitialValues<T>(input: {
  directEdit: boolean
  editInitialValues?: T
  credentialPrefill?: T
}): T | undefined {
  if (input.directEdit) return input.editInitialValues
  return input.credentialPrefill
}
