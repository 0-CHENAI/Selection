import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { fastTransportFamily } from '../../shared/src/agent/fast-mode.ts'

/** Read the preference per request, including tool continuations and recreated sessions. */
export function installFastServiceTier(session: AgentSession, enabled: () => boolean | undefined): void {
  const stream = session.agent.streamFunction
  session.agent.streamFunction = (model, context, options) => {
    if (!fastTransportFamily(model.id, model.provider, model.api, model.baseUrl)) return stream(model, context, options)
    const serviceTier = enabled() ? 'priority' : 'default'
    // Pi's simple-stream adapter drops provider-specific serviceTier options.
    // Apply at the final payload boundary and preserve existing payload hooks.
    return stream(model, context, {
      ...options,
      // service_tier in a successful response is descriptive, not a failure.
      // The provider may serve the request at its default tier; preserve its
      // content/tool calls and the caller's event hook without retrying it.
      onPayload: async (payload, requestModel) => {
        const body = await options?.onPayload?.(payload, requestModel) ?? payload
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid Fast payload')
        return { ...body, service_tier: serviceTier }
      },
    })
  }
}
