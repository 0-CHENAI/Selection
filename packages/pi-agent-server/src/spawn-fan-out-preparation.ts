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

/**
 * Prepare a fan-out contract without approving or executing any tool. Pi emits
 * message_end before starting the parallel tool batch, so each real execution
 * can later consume its contract by tool-call id regardless of approval delay.
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
    try {
      const argumentsToValidate = tool.prepareArguments
        ? tool.prepareArguments(block.arguments)
        : block.arguments
      if (!isRecord(argumentsToValidate)) return []
      validated = validateToolArguments(tool, {
        type: 'toolCall',
        id: block.id,
        name: tool.name,
        arguments: argumentsToValidate,
      })
    } catch {
      return []
    }
    if (!isRecord(validated) || typeof validated.prompt !== 'string') return []

    return [{
      id: block.id,
      arguments: validated,
      name: typeof validated.name === 'string' ? validated.name : undefined,
      prompt: validated.prompt,
    }]
  })

  const qualification = synthesizeFanOutQualification(calls)
  if (!qualification) return prepared

  for (const call of calls) {
    if (call.arguments.qualification == null) {
      prepared.set(call.id, qualification)
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
