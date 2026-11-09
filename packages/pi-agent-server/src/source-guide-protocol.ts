export interface SourceGuidePreparation {
  sourceSlug: string;
  guidePath: string;
  guideContent: string;
  guideVersion: string;
  assistantGeneration?: number;
  alreadyPreparedInGeneration: boolean;
}

/** Model-visible successful tool result; the requested business operation never ran. */
export function formatSourceGuidePreparationResult(preparation: SourceGuidePreparation): string {
  const header = `Internal source preparation for "${preparation.sourceSlug}".`;
  const instructions = preparation.alreadyPreparedInGeneration
    ? 'The source instructions were provided by another internal result in this assistant turn.'
    : `Source usage instructions:\n\n${preparation.guideContent}`;

  return [
    header,
    instructions,
    'IMPORTANT: The requested source tool was NOT executed. No request was sent and no changes were made.',
    'Read the instructions above, reconsider the correct source tool and arguments, then issue a new tool call if still appropriate.',
  ].join('\n\n');
}

/** Preserve real preparation failures, including proxy errors stored in result.details. */
export function getSourceGuidePreparationFailure(isError: boolean, result: unknown): string | null {
  const record = result && typeof result === 'object'
    ? result as { content?: unknown; details?: { isError?: unknown } }
    : undefined;
  if (!isError && record?.details?.isError !== true) return null;

  const messages = Array.isArray(record?.content)
    ? record.content.flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const text = (part as { type?: unknown; text?: unknown }).text;
      return typeof text === 'string' && text.trim() ? [text.trim()] : [];
    })
    : [];

  return messages.join('\n') || 'Source instructions could not be delivered to the model context.';
}

/** Hold speculative Source starts until the main process identifies real execution. */
export class SourceGuideEventGate<T> {
  private bufferedStarts = new Map<string, T>();
  private suppressedCalls = new Map<string, SourceGuidePreparation>();

  bufferStart(toolCallId: string, event: T): void {
    this.bufferedStarts.set(toolCallId, event);
  }

  releaseStart(toolCallId: string): T | undefined {
    const event = this.bufferedStarts.get(toolCallId);
    this.bufferedStarts.delete(toolCallId);
    return event;
  }

  suppress(toolCallId: string, preparation: SourceGuidePreparation): void {
    this.bufferedStarts.delete(toolCallId);
    this.suppressedCalls.set(toolCallId, preparation);
  }

  consumeSuppressed(toolCallId: string): SourceGuidePreparation | undefined {
    const preparation = this.suppressedCalls.get(toolCallId);
    this.suppressedCalls.delete(toolCallId);
    return preparation;
  }

  clear(): void {
    this.bufferedStarts.clear();
    this.suppressedCalls.clear();
  }
}
