import { describe, expect, it } from 'bun:test'
import { isOrderCredentialPrefill } from '../order-prefill'

describe('isOrderCredentialPrefill', () => {
  it('recognizes the ORDER welcome-card prefill', () => {
    expect(isOrderCredentialPrefill({
      activePreset: 'order-openai',
      baseUrl: 'https://order.ai.jxepdi.top/v1',
    })).toBe(true)
  })

  it('recognizes an ORDER gateway URL saved without the preset key', () => {
    expect(isOrderCredentialPrefill({
      baseUrl: 'https://order.ai.jxepdi.top/v1',
    })).toBe(true)
  })

  it('does not treat a generic or empty form as ORDER', () => {
    expect(isOrderCredentialPrefill(undefined)).toBe(false)
    expect(isOrderCredentialPrefill({ activePreset: 'amazon-bedrock' })).toBe(false)
    expect(isOrderCredentialPrefill({ baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com' })).toBe(false)
  })
})
