import {
  recoverKnownToolInput,
  type ToolCompatEvent,
} from '../../shared/src/agent/core/tool-input-recovery.ts';
import {
  isSpawnSessionToolName,
  recoverSpawnSessionArguments,
} from '../../shared/src/agent/core/spawn-session-args.ts';

type ArgumentPreparer = (args: unknown) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recoverRecord(
  toolName: string,
  args: unknown,
  recoveries: ToolCompatEvent[],
): unknown {
  if (!isRecord(args)) return args;
  const recovered = recoverKnownToolInput(toolName, args);
  recoveries.push(...recovered.recoveries);
  return recovered.input;
}

/** Compose narrow provider recovery into Pi's pre-validation argument hook. */
export function createRecoveringArgumentPreparer(
  toolName: string,
  original?: ArgumentPreparer,
  allowRichMetadata = true,
  onRecovered?: (recoveries: ToolCompatEvent[]) => void,
): ArgumentPreparer {
  return args => {
    const recoveries: ToolCompatEvent[] = [];
    const recovered = recoverRecord(toolName, args, recoveries);
    const prepared = original ? original(recovered) : recovered;
    const afterIntent = recoverRecord(toolName, prepared, recoveries);
    const finalArgs = isRecord(afterIntent) && isSpawnSessionToolName(toolName)
      ? recoverSpawnSessionArguments(afterIntent)
      : afterIntent;
    if (recoveries.length > 0) onRecovered?.(recoveries);
    if (allowRichMetadata || !isRecord(finalArgs)) return finalArgs;

    const sanitized = { ...finalArgs };
    delete sanitized._intent;
    delete sanitized._displayName;
    return sanitized;
  };
}
