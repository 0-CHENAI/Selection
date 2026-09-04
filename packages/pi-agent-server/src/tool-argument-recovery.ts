import { recoverKnownToolInputFromIntent } from '../../shared/src/agent/core/tool-input-recovery.ts';
import {
  isSpawnSessionToolName,
  recoverSpawnSessionArguments,
} from '../../shared/src/agent/core/spawn-session-args.ts';

type ArgumentPreparer = (args: unknown) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compose narrow provider recovery into Pi's pre-validation argument hook. */
export function createRecoveringArgumentPreparer(
  toolName: string,
  original?: ArgumentPreparer,
  allowRichMetadata = true,
): ArgumentPreparer {
  return args => {
    const recovered = isRecord(args) ? recoverKnownToolInputFromIntent(toolName, args) : args;
    const prepared = original ? original(recovered) : recovered;
    const afterIntent = isRecord(prepared)
      ? recoverKnownToolInputFromIntent(toolName, prepared)
      : prepared;
    const finalArgs = isRecord(afterIntent) && isSpawnSessionToolName(toolName)
      ? recoverSpawnSessionArguments(afterIntent)
      : afterIntent;
    if (allowRichMetadata || !isRecord(finalArgs)) return finalArgs;

    const sanitized = { ...finalArgs };
    delete sanitized._intent;
    delete sanitized._displayName;
    return sanitized;
  };
}
