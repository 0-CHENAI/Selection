import { modelThinkingCapability, type ThinkingModelRef } from './thinking-capabilities.ts'
import {
  toCustomEndpointModelPayload,
  type CustomEndpointModelPayload,
  type CustomEndpointModelSource,
} from '../config/model-image-support.ts'

/** Carry resolved capabilities into the Pi process, which has its own catalog state. */
export function toCustomEndpointModelWithThinking(
  model: CustomEndpointModelSource & (string | ThinkingModelRef),
  provider?: string,
): CustomEndpointModelPayload {
  const payload = toCustomEndpointModelPayload(model)
  const ref = typeof model === 'string' ? { id: model, provider } : { ...model, provider: provider ?? model.provider }
  if (ref.supportedThinkingLevels !== undefined || ref.thinkingMode || ref.thinkingSource === 'explicit') return payload

  const capability = modelThinkingCapability(ref)
  if (capability.mode === 'unsupported') return payload
  const entry = typeof payload === 'string' ? { id: payload } : payload
  return capability.mode === 'always-on'
    ? { ...entry, thinkingMode: 'always-on' }
    : { ...entry, supportedThinkingLevels: capability.levels }
}
