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

const OFFICECLI_MODEL_REQUEST_TIMEOUT_MS = 35_000;

export const OFFICECLI_MODEL_STREAM_DEADLINE_MS = 35_000;
export const OFFICECLI_MODEL_TASK_WAIT_BUDGET_MS = 210_000;
const OFFICECLI_MODEL_STREAM_MAX_ATTEMPTS = 2;
const OFFICECLI_MODEL_STREAM_MAX_EVENTS = 100_000;
const OFFICECLI_MODEL_STREAM_MAX_DELTA_CHARS = 8 * 1024 * 1024;

export function isOfficecliDocumentTask(promptContext: string | undefined): boolean {
  if (!promptContext) return false;
  return promptContext.includes('# OfficeCLI execution policy') ||
    promptContext.includes('officecli-execution/SKILL.md');
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
 * Bound a single provider request for Office generation so one stalled call
 * cannot consume the entire five-minute task budget. Other tasks retain the
 * user's original Pi settings.
 */
export function providerRetrySettingsForTask(
  systemPrompt: string | undefined,
  baseline: ProviderRetrySettings,
): ProviderRetrySettings {
  if (!isOfficecliDocumentTask(systemPrompt)) return { ...baseline };
  return {
    timeoutMs: Math.min(baseline.timeoutMs ?? OFFICECLI_MODEL_REQUEST_TIMEOUT_MS, OFFICECLI_MODEL_REQUEST_TIMEOUT_MS),
    // The absolute stream wrapper owns the bounded retries so provider SDK
    // retries cannot multiply the wall-clock budget invisibly.
    maxRetries: 0,
    maxRetryDelayMs: Math.min(baseline.maxRetryDelayMs, 5_000),
  };
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
 * Add an absolute wall-clock deadline around the complete provider stream.
 * Pi's timeoutMs is an HTTP idle timeout, so a provider that trickles events can
 * otherwise keep a document turn alive until the app-wide five-minute limit.
 */
export function createOfficecliDeadlineStreamFn(
  baseStreamFn: StreamFn,
  isActive: (context: Context) => boolean,
  deadlineMs = OFFICECLI_MODEL_STREAM_DEADLINE_MS,
  onRetryAttempt?: (attempt: number) => void,
  taskWaitBudgetMs = OFFICECLI_MODEL_TASK_WAIT_BUDGET_MS,
): StreamFn {
  let activeUserTurnKey: string | undefined;
  let taskWaitUsedMs = 0;

  return (model, context, options) => {
    if (!isActive(context)) return baseStreamFn(model, context, options);

    let latestUserIndex = -1;
    let latestUserTimestamp = 0;
    for (let index = context.messages.length - 1; index >= 0; index -= 1) {
      const message = context.messages[index]!;
      if (message.role !== 'user') continue;
      latestUserIndex = index;
      latestUserTimestamp = message.timestamp;
      break;
    }
    const userTurnKey = `${latestUserIndex}:${latestUserTimestamp}`;
    if (userTurnKey !== activeUserTurnKey) {
      activeUserTurnKey = userTurnKey;
      taskWaitUsedMs = 0;
    }

    const output = createAssistantMessageEventStream();
    const upstreamSignal = options?.signal;
    let latestPartial: AssistantMessage | undefined;

    void (async () => {
      // Retry only when a timed-out attempt emitted no events. Once visible
      // stream state exists it cannot be retracted safely, so that attempt ends
      // with a bounded error instead of mixing two assistant responses.
      for (let attempt = 1; attempt <= OFFICECLI_MODEL_STREAM_MAX_ATTEMPTS; attempt += 1) {
        const taskWaitRemainingMs = taskWaitBudgetMs - taskWaitUsedMs;
        if (taskWaitRemainingMs <= 0) {
          output.push({
            type: 'error',
            reason: 'aborted',
            error: deadlineErrorMessage(
              model,
              latestPartial,
              taskWaitBudgetMs,
              'aborted',
              `OfficeCLI document task exhausted its ${taskWaitBudgetMs}ms cumulative model-wait budget`,
            ),
          });
          return;
        }
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
        const attemptStartedAt = Date.now();
        const attemptDeadlineMs = Math.max(1, Math.min(deadlineMs, taskWaitRemainingMs));

        const controller = new AbortController();
        let emittedDurableEvent = false;
        let abandoned = false;
        let sourceIterator: AsyncIterator<AssistantMessageEvent> | undefined;
        const bufferedEvents: AssistantMessageEvent[] = [];
        let iteratorReturnRequested = false;
        let eventCount = 0;
        let deltaChars = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abortFromUpstream: (() => void) | undefined;
        const interrupted = new Promise<'deadline' | 'upstream'>(resolve => {
          timer = setTimeout(() => {
            abandoned = true;
            controller.abort(new Error('OfficeCLI model stream deadline exceeded'));
            resolve('deadline');
          }, attemptDeadlineMs);
          abortFromUpstream = () => {
            abandoned = true;
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
              timeoutMs: Math.min(options?.timeoutMs ?? attemptDeadlineMs, attemptDeadlineMs),
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
        taskWaitUsedMs += Math.max(0, Date.now() - attemptStartedAt);
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
          if (!emittedDurableEvent &&
              attempt < OFFICECLI_MODEL_STREAM_MAX_ATTEMPTS &&
              taskWaitUsedMs < taskWaitBudgetMs) continue;
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
                : taskWaitUsedMs >= taskWaitBudgetMs
                  ? `OfficeCLI document task exhausted its ${taskWaitBudgetMs}ms cumulative model-wait budget`
                  : `OfficeCLI document model request exceeded the ${deadlineMs}ms deadline twice`,
            ),
          });
          return;
        }

        if (outcome.kind === 'complete') {
          return;
        }

        output.push({
          type: 'error',
          reason: controller.signal.aborted ? 'aborted' : 'error',
          error: deadlineErrorMessage(
            model,
            latestPartial,
            deadlineMs,
            controller.signal.aborted ? 'aborted' : 'error',
            outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
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
