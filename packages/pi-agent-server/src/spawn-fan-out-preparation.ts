import { validateToolArguments } from '@earendil-works/pi-ai/compat'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { SpawnSessionQualification } from '../../shared/src/agent/base-agent.ts'
import { resolveSessionToolProxyName } from '../../shared/src/agent/backend/pi/session-tool-defs.ts'
import { synthesizeFanOutQualification } from '../../shared/src/agent/spawn-session-tool.ts'

interface AssistantContentBlock {
  type: string
  id?: string
  name?: string
  arguments?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Before the V3 fan-out contract, some models emitted one otherwise-complete
 * track per worker. Recognize only that narrow legacy shape; all other invalid
 * qualification objects must continue to fail normal schema validation.
 */
function isLegacySingleTrackQualification(value: unknown): value is SpawnSessionQualification {
  if (!isRecord(value)
    || !Array.isArray(value.tracks)
    || value.tracks.length !== 1
    || !isNonEmptyString(value.parallelBenefit)
    || !isNonEmptyString(value.finalAggregation)
  ) {
    return false
  }

  const track = value.tracks[0]
  return isRecord(track)
    && isNonEmptyString(track.name)
    && isNonEmptyString(track.input)
    && isNonEmptyString(track.expectedOutput)
    && isNonEmptyString(track.evidence)
    && Array.isArray(track.toolKinds)
    && track.toolKinds.length > 0
    && track.toolKinds.every(isNonEmptyString)
}

/**
 * Prepare a fan-out contract without approving or executing any tool. Pi emits
 * message_end before starting the parallel tool batch, so each real execution
 * can later consume its contract by tool-call id regardless of approval delay.
 * A valid legacy one-track contract is upgraded in-place only after the whole
 * message proves that at least two distinct workers form a real fan-out. This
 * happens before Pi validates the calls for execution.
 */
export function prepareSpawnFanOutQualifications(
  stopReason: string | undefined,
  content: readonly AssistantContentBlock[],
  activeTools: readonly ToolDefinition<any, any>[],
): Map<string, SpawnSessionQualification> {
  const prepared = new Map<string, SpawnSessionQualification>()
  if (stopReason !== 'toolUse' && stopReason !== 'stop') return prepared

  const registeredSpawnTools = new Map(activeTools
    .filter(tool => resolveSessionToolProxyName(tool.name) === 'mcp__session__spawn_session')
    .map(tool => [tool.name, tool]))
  const calls = content.flatMap((block) => {
    const tool = block.name ? registeredSpawnTools.get(block.name) : undefined
    if (block.type !== 'toolCall'
      || !block.id
      || !tool
      || !isRecord(block.arguments)
    ) {
      return []
    }

    let validated: unknown
    let upgradeLegacyQualification = false
    let argumentsToValidate: Record<string, unknown> | undefined
    try {
      const preparedArguments = tool.prepareArguments
        ? tool.prepareArguments(block.arguments)
        : block.arguments
      if (!isRecord(preparedArguments)) return []
      argumentsToValidate = preparedArguments
      validated = validateToolArguments(tool, {
        type: 'toolCall',
        id: block.id,
        name: tool.name,
        arguments: argumentsToValidate,
      })
    } catch {
      if (!argumentsToValidate
        || !isLegacySingleTrackQualification(argumentsToValidate.qualification)
      ) {
        return []
      }

      const withoutLegacyQualification = { ...argumentsToValidate }
      delete withoutLegacyQualification.qualification
      try {
        validated = validateToolArguments(tool, {
          type: 'toolCall',
          id: block.id,
          name: tool.name,
          arguments: withoutLegacyQualification,
        })
        upgradeLegacyQualification = true
      } catch {
        // Removing a legacy qualification must never hide an unrelated schema
        // error such as an invalid lifecycle or permission mode.
        return []
      }
    }
    if (!isRecord(validated) || typeof validated.prompt !== 'string') return []

    return [{
      id: block.id,
      arguments: validated,
      name: typeof validated.name === 'string' ? validated.name : undefined,
      prompt: validated.prompt,
      block,
      upgradeLegacyQualification,
    }]
  })

  const qualification = synthesizeFanOutQualification(calls)
  if (!qualification) return prepared

  for (const call of calls) {
    if (call.arguments.qualification == null || call.upgradeLegacyQualification) {
      prepared.set(call.id, qualification)
      if (call.upgradeLegacyQualification) {
        // The SDK validates tool arguments after message_end. Update the exact
        // assistant content block it will execute so the V3 contract reaches
        // validation, persistence, approval, and execution consistently.
        call.block.arguments = { ...call.arguments, qualification }
      }
    }
  }
  return prepared
}

/** Turn-scoped storage kept separate so execution order and cleanup are testable. */
export class SpawnFanOutQualificationCache {
  private readonly byToolCallId = new Map<string, SpawnSessionQualification>()

  prepare(
    stopReason: string | undefined,
    content: readonly AssistantContentBlock[],
    activeTools: readonly ToolDefinition<any, any>[],
  ): void {
    this.clear()
    for (const [toolCallId, qualification] of prepareSpawnFanOutQualifications(
      stopReason,
      content,
      activeTools,
    )) {
      this.byToolCallId.set(toolCallId, qualification)
    }
  }

  consume(toolCallId: string): SpawnSessionQualification | undefined {
    const qualification = this.byToolCallId.get(toolCallId)
    this.byToolCallId.delete(toolCallId)
    return qualification
  }

  clear(): void {
    this.byToolCallId.clear()
  }
}
