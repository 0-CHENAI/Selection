import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { gptOAuthServiceTier } from '../../shared/src/agent/fast-mode.ts'

/** Read the preference per request, including tool continuations and recreated sessions. */
export function installGptOAuthFast(session: AgentSession, enabled: () => boolean | undefined): void {
  const stream = session.agent.streamFunction
  session.agent.streamFunction = (model, context, options) => {
    const serviceTier = gptOAuthServiceTier(enabled(), model.id, model.provider)
    if (!serviceTier) return stream(model, context, options)
    // Pi's simple-stream adapter drops provider-specific serviceTier options.
    // Apply at the final payload boundary and preserve existing payload hooks.
    return stream(model, context, {
      ...options,
      onProviderStreamEvent: async (event, requestModel) => {
        await options?.onProviderStreamEvent?.(event, requestModel)
        const response = event as { type?: string; response?: { service_tier?: string } }
        if (serviceTier === 'priority' && response.type === 'response.completed' && response.response?.service_tier === 'default') {
          throw new Error('Fast 未生效：服务端按普通速度处理了本次请求。请检查账号或模型是否支持 Fast。')
        }
      },
      onPayload: async (payload, requestModel) => {
        const body = await options?.onPayload?.(payload, requestModel) ?? payload
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid GPT OAuth payload')
        return { ...body, service_tier: serviceTier }
      },
    })
  }
}
