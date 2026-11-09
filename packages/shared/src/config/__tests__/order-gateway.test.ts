import { describe, expect, it } from 'bun:test'
import {
  displayLlmConnectionName,
  isGenericCustomEndpointName,
  isOrderGatewayUrl,
  isOrderOpenAiUrl,
  ORDER_CONNECTION_NAME,
} from '../order-gateway.ts'

describe('ORDER gateway identity', () => {
  it('detects Anthropic and OpenAI ORDER bases', () => {
    expect(isOrderGatewayUrl('https://order.ai.jxepdi.top')).toBe(true)
    expect(isOrderGatewayUrl('https://order.ai.jxepdi.top/v1')).toBe(true)
    expect(isOrderOpenAiUrl('https://order.ai.jxepdi.top')).toBe(false)
    expect(isOrderOpenAiUrl('https://order.ai.jxepdi.top/v1')).toBe(true)
    expect(isOrderGatewayUrl('https://api.anthropic.com')).toBe(false)
  })

  it('relabels generic custom-endpoint names for ORDER URLs', () => {
    expect(isGenericCustomEndpointName('Custom Anthropic-Compatible')).toBe(true)
    expect(displayLlmConnectionName({
      name: 'Custom Anthropic-Compatible',
      baseUrl: 'https://order.ai.jxepdi.top',
    })).toBe(ORDER_CONNECTION_NAME)
  })

  it('keeps a user-renamed ORDER connection', () => {
    expect(displayLlmConnectionName({
      name: '巡察网关',
      baseUrl: 'https://order.ai.jxepdi.top',
    })).toBe('巡察网关')
  })
})
