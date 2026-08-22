import { recoverKnownToolInputFromIntent } from '../../shared/src/agent/core/tool-input-recovery.ts';

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
    const finalArgs = isRecord(prepared)
      ? recoverKnownToolInputFromIntent(toolName, prepared)
      : prepared;
    if (allowRichMetadata || !isRecord(finalArgs)) return finalArgs;

    const sanitized = { ...finalArgs };
    delete sanitized._intent;
    delete sanitized._displayName;
    return sanitized;
  };
}
