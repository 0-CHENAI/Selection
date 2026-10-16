import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolveSettingsApiSetupInitialValues } from '../api-setup-initial-values'

const ORDER_PREFILL = {
  activePreset: 'order-openai',
  baseUrl: 'https://order.ai.jxepdi.top/v1',
  customApi: 'openai-completions' as const,
}

const BEDROCK_EDIT = {
  activePreset: 'amazon-bedrock',
  baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
}

describe('resolveSettingsApiSetupInitialValues', () => {
  it('sends the ORDER welcome-card prefill into a new connection form', () => {
    expect(resolveSettingsApiSetupInitialValues({
      directEdit: false,
      editInitialValues: undefined,
      credentialPrefill: ORDER_PREFILL,
    })).toEqual(ORDER_PREFILL)
  })

  it('does not reuse a previous Bedrock edit when the welcome card did not prefill', () => {
    expect(resolveSettingsApiSetupInitialValues({
      directEdit: false,
      editInitialValues: BEDROCK_EDIT,
      credentialPrefill: undefined,
    })).toBeUndefined()
  })

  it('keeps the saved connection when editing directly', () => {
    expect(resolveSettingsApiSetupInitialValues({
      directEdit: true,
      editInitialValues: BEDROCK_EDIT,
      credentialPrefill: ORDER_PREFILL,
    })).toEqual(BEDROCK_EDIT)
  })

  it('wires the settings wizard to the onboarding prefill', () => {
    const page = readFileSync(new URL('../AiSettingsPage.tsx', import.meta.url), 'utf8')
    expect(page).toContain('resolveSettingsApiSetupInitialValues')
    expect(page).toContain('credentialPrefill: apiSetupOnboarding.credentialPrefill')
    expect(page).not.toContain('editInitialValues={editInitialValues}')
  })
})
