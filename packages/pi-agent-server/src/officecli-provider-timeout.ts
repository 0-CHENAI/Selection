import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

export interface ProviderRetrySettings {
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs: number;
}

const OFFICECLI_MODEL_REQUEST_TIMEOUT_MS = 300_000;

export const OFFICECLI_MODEL_STREAM_DEADLINE_MS = 300_000;
const OFFICECLI_MODEL_STREAM_MAX_ATTEMPTS = 3;
const OFFICECLI_RETRYABLE_PROVIDER_DELAY_MS = 2_000;
const OFFICECLI_MODEL_STREAM_MAX_EVENTS = 100_000;
const OFFICECLI_MODEL_STREAM_MAX_DELTA_CHARS = 8 * 1024 * 1024;

export function isOfficecliDocumentTask(promptContext: string | undefined): boolean {
  if (!promptContext) return false;
  return promptContext.includes('# OfficeCLI execution policy') ||
    promptContext.includes('officecli-execution/SKILL.md') ||
    promptContext.includes('officecli/SKILL.md') ||
    promptContext.includes('officecli load_skill');
}

function userMessageText(message: Context['messages'][number]): string {
  if (message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

/** Bind the policy to the latest user turn carried into this exact provider request. */
export function isOfficecliDocumentContext(context: Context): boolean {
  if (isOfficecliDocumentTask(context.systemPrompt)) return true;
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    const message = context.messages[index]!;
    if (message.role === 'user') return isOfficecliDocumentTask(userMessageText(message));
  }
  return false;
}

/**
 * Document turns need a longer HTTP idle floor than ordinary chat. The
 * stream wrapper owns stall retries, so the SDK does not stack extra ones.
 */
export function providerRetrySettingsForTask(
  systemPrompt: string | undefined,
  baseline: ProviderRetrySettings,
): ProviderRetrySettings {
  if (!isOfficecliDocumentTask(systemPrompt)) return { ...baseline };
  return {
    timeoutMs: Math.max(baseline.timeoutMs ?? OFFICECLI_MODEL_REQUEST_TIMEOUT_MS, OFFICECLI_MODEL_REQUEST_TIMEOUT_MS),
    maxRetries: 0,
    maxRetryDelayMs: Math.min(baseline.maxRetryDelayMs, 5_000),
  };
}

export function isOfficecliRetryableProviderError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('rate limit')
    || lower.includes('too many requests')
    || lower.includes('overloaded')
    || lower.includes('temporarily unavailable')
    || lower.includes('internal server error')
    || lower.includes('ended without a terminal event')
    || /\b429\b/.test(lower)
    || /\b50[0-4]\b/.test(lower);
}

function emptyUsage(): AssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Hidden reasoning and visible tokens both count as progress for the idle clock. */
function isOfficecliProgressEvent(event: AssistantMessageEvent): boolean {
  if (event.type === 'thinking_start' || event.type === 'thinking_end') return true;
  if (!('delta' in event) || typeof event.delta !== 'string' || event.delta.length === 0) {
    return false;
  }
  return event.type === 'thinking_delta' || event.type === 'text_delta' || event.type === 'toolcall_delta';
}

function deadlineErrorMessage(
  model: Model<any>,
  partial: AssistantMessage | undefined,
  deadlineMs: number,
  reason: 'aborted' | 'error',
  detail?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: partial?.content ?? [],
    api: partial?.api ?? model.api,
    provider: partial?.provider ?? model.provider,
    model: partial?.model ?? model.id,
    responseModel: partial?.responseModel,
    responseId: partial?.responseId,
    diagnostics: partial?.diagnostics,
    usage: partial?.usage ?? emptyUsage(),
    stopReason: reason,
    errorMessage: detail ?? `OfficeCLI document model request exceeded the ${deadlineMs}ms deadline`,
    timestamp: Date.now(),
  };
}

/**
 * Idle-out a stalled Office provider stream. Thinking / text / tool deltas
 * reset the clock so a high-thinking model can plan a document for as long
 * as it is still working. A silent stall or a 429/5xx with no visible
 * output is retried; a progressing stream is never killed by a turn budget.
 */
export function createOfficecliDeadlineStreamFn(
  baseStreamFn: StreamFn,
  isActive: (context: Context) => boolean,
  deadlineMs = OFFICECLI_MODEL_STREAM_DEADLINE_MS,
  onRetryAttempt?: (attempt: number) => void,
  retryDelayMs = OFFICECLI_RETRYABLE_PROVIDER_DELAY_MS,
): StreamFn {
  return (model, context, options) => {
    if (!isActive(context)) return baseStreamFn(model, context, options);

    const output = createAssistantMessageEventStream();
    const upstreamSignal = options?.signal;
    let latestPartial: AssistantMessage | undefined;

    void (async () => {
      // Retry only when a timed-out or transient attempt emitted no visible
      // output. Once stream state exists it cannot be retracted safely.
      for (let attempt = 1; attempt <= OFFICECLI_MODEL_STREAM_MAX_ATTEMPTS; attempt += 1) {
        if (upstreamSignal?.aborted) {
          output.push({
            type: 'error',
            reason: 'aborted',
            error: deadlineErrorMessage(
              model,
              latestPartial,
              deadlineMs,
              'aborted',
              'OfficeCLI document model request was aborted',
            ),
          });
          return;
        }
        if (attempt > 1) onRetryAttempt?.(attempt);
        const attemptDeadlineMs = Math.max(1, deadlineMs);

        const controller = new AbortController();
        let emittedDurableEvent = false;
        let abandoned = false;
        let interruptSettled = false;
        let sourceIterator: AsyncIterator<AssistantMessageEvent> | undefined;
        const bufferedEvents: AssistantMessageEvent[] = [];
        let iteratorReturnRequested = false;
        let eventCount = 0;
        let deltaChars = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abortFromUpstream: (() => void) | undefined;
        let settleInterrupt: ((reason: 'deadline' | 'upstream') => void) | undefined;
        const resetIdleTimer = () => {
          if (interruptSettled || abandoned) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (interruptSettled) return;
            abandoned = true;
            interruptSettled = true;
            controller.abort(new Error('OfficeCLI model stream deadline exceeded'));
            settleInterrupt?.('deadline');
          }, attemptDeadlineMs);
        };
        const interrupted = new Promise<'deadline' | 'upstream'>(resolve => {
          settleInterrupt = resolve;
          resetIdleTimer();
          abortFromUpstream = () => {
            if (interruptSettled) return;
            abandoned = true;
            interruptSettled = true;
            controller.abort(upstreamSignal?.reason);
            resolve('upstream');
          };
          upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
        });

        const consumeAttempt = async (): Promise<
          | { kind: 'complete' }
          | { kind: 'error'; error: unknown }
        > => {
          const closeIterator = () => {
            if (iteratorReturnRequested || !sourceIterator?.return) return;
            iteratorReturnRequested = true;
            void sourceIterator.return().catch(() => undefined);
          };
          try {
            const boundedOptions: SimpleStreamOptions = {
              ...options,
              signal: controller.signal,
              timeoutMs: attemptDeadlineMs,
              maxRetries: 0,
              maxRetryDelayMs: Math.min(options?.maxRetryDelayMs ?? 5_000, 5_000),
            };
            const source = await baseStreamFn(model, context, boundedOptions);
            sourceIterator = source[Symbol.asyncIterator]();
            if (abandoned) {
              return { kind: 'error', error: new Error('OfficeCLI document model stream was abandoned') };
            }
            while (true) {
              const next = await sourceIterator.next();
              if (next.done || abandoned) break;
              const event = next.value;
              eventCount += 1;
              if ('delta' in event && typeof event.delta === 'string') deltaChars += event.delta.length;
              if (
                eventCount > OFFICECLI_MODEL_STREAM_MAX_EVENTS ||
                deltaChars > OFFICECLI_MODEL_STREAM_MAX_DELTA_CHARS
              ) {
                controller.abort(new Error('OfficeCLI model stream exceeded the bounded event limit'));
                return { kind: 'error', error: new Error('OfficeCLI model stream exceeded the bounded event limit') };
              }
              const durable = (event.type === 'text_delta' && event.delta.length > 0) ||
                (event.type === 'text_end' && event.content.length > 0) ||
                (event.type === 'toolcall_delta' && event.delta.length > 0) ||
                event.type === 'toolcall_end';
              if (isOfficecliProgressEvent(event)) resetIdleTimer();
              const eventWithPartial = event as AssistantMessageEvent & { partial?: AssistantMessage };
              if (eventWithPartial.partial) latestPartial = eventWithPartial.partial;
              if (event.type === 'error' && !emittedDurableEvent) {
                latestPartial = event.error;
                return {
                  kind: 'error',
                  error: new Error(event.error.errorMessage ?? 'OfficeCLI document provider stream failed'),
                };
              }
              if (!emittedDurableEvent) {
                bufferedEvents.push(event);
                if (durable || event.type === 'done' || event.type === 'error') {
                  for (const buffered of bufferedEvents.splice(0)) output.push(buffered);
                }
              } else {
                output.push(event);
              }
              emittedDurableEvent ||= durable;
              if (event.type === 'done' || event.type === 'error') {
                return { kind: 'complete' };
              }
            }
            return {
              kind: 'error',
              error: new Error('OfficeCLI document model stream ended without a terminal event'),
            };
          } catch (error) {
            return { kind: 'error', error };
          } finally {
            // A terminal event, cancellation, deadline or limit all close the
            // iterator through the same path. Non-compliant providers cannot
            // keep being consumed after the wrapper has returned.
            closeIterator();
          }
        };

        const attemptPromise = consumeAttempt();
        const outcome = await Promise.race([attemptPromise, interrupted]);
        if (timer) clearTimeout(timer);
        if (abortFromUpstream) upstreamSignal?.removeEventListener('abort', abortFromUpstream);

        if (outcome === 'upstream') {
          abandoned = true;
          if (!iteratorReturnRequested && sourceIterator?.return) {
            iteratorReturnRequested = true;
            void sourceIterator.return().catch(() => undefined);
          }
          output.push({
            type: 'error',
            reason: 'aborted',
            error: deadlineErrorMessage(
              model,
              latestPartial,
              deadlineMs,
              'aborted',
              'OfficeCLI document model request was aborted',
            ),
          });
          return;
        }

        if (outcome === 'deadline') {
          abandoned = true;
          if (!iteratorReturnRequested && sourceIterator?.return) {
            iteratorReturnRequested = true;
            void sourceIterator.return().catch(() => undefined);
          }
          // The abort signal should settle the abandoned consumer; attach a
          // handler so a non-compliant provider cannot create an unhandled task.
          void attemptPromise.catch(() => undefined);
          // A provider may start a hidden thinking block and then stall. Those
          // buffered events were never forwarded, so a fresh attempt cannot
          // leave two assistant messages in downstream context.
          if (!emittedDurableEvent && attempt < OFFICECLI_MODEL_STREAM_MAX_ATTEMPTS) continue;
          output.push({
            type: 'error',
            reason: 'aborted',
            error: deadlineErrorMessage(
              model,
              latestPartial,
              deadlineMs,
              'aborted',
              emittedDurableEvent
                ? `OfficeCLI document model request exceeded the ${deadlineMs}ms deadline after streaming began`
                : `OfficeCLI document model request exceeded the ${deadlineMs}ms deadline`,
            ),
          });
          return;
        }

        if (outcome.kind === 'complete') {
          return;
        }

        const providerError = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        if (
          !emittedDurableEvent
          && attempt < OFFICECLI_MODEL_STREAM_MAX_ATTEMPTS
          && isOfficecliRetryableProviderError(providerError)
        ) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          continue;
        }

        output.push({
          type: 'error',
          reason: controller.signal.aborted ? 'aborted' : 'error',
          error: deadlineErrorMessage(
            model,
            latestPartial,
            deadlineMs,
            controller.signal.aborted ? 'aborted' : 'error',
            providerError,
          ),
        });
        return;
      }
    })().catch(error => {
      output.push({
        type: 'error',
        reason: 'error',
        error: deadlineErrorMessage(
          model,
          latestPartial,
          deadlineMs,
          'error',
          error instanceof Error ? error.message : String(error),
        ),
      });
    });

    return output;
  };
}
