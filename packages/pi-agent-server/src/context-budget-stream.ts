import {
  createAssistantMessageEventStream,
  isContextOverflow,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ModelsSimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { ModelRuntime as PiModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  buildContextBudget,
  calculateOverflowRetryMaxTokens,
} from '../../shared/src/agent/backend/pi/context-budget.ts';

type RuntimeStreamSimple = (
  model: Model<Api>,
  context: Context,
  options?: ModelsSimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ContextBudgetDebugInfo {
  phase: 'preflight' | 'retry';
  model: string;
  requestedMaxTokens: number;
  appliedMaxTokens: number;
  estimatedInputTokens?: number;
  reserveTokens?: number;
}

type DebugLogger = (info: ContextBudgetDebugInfo) => void;

const installedRuntimes = new WeakSet<PiModelRuntime>();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createThrownErrorMessage(model: Model<Api>, error: unknown): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage: errorText(error),
    timestamp: Date.now(),
  };
}

function isIrreversibleOutput(event: AssistantMessageEvent): boolean {
  switch (event.type) {
    case 'text_delta':
    case 'thinking_delta':
    case 'toolcall_delta':
      return event.delta.length > 0;
    case 'text_end':
    case 'thinking_end':
      return event.content.length > 0;
    case 'toolcall_end':
      return true;
    default:
      return false;
  }
}

function pushAll(
  target: AssistantMessageEventStream,
  events: readonly AssistantMessageEvent[],
): void {
  for (const event of events) target.push(event);
}

/**
 * Wrap one Pi stream invocation with a conservative preflight budget and at
 * most one lower-budget retry. The first attempt is retried only before any
 * visible content or completed tool call, so writes and streamed text cannot
 * be duplicated.
 */
export function createContextBudgetedStream(
  streamSimple: RuntimeStreamSimple,
  model: Model<Api>,
  context: Context,
  options?: ModelsSimpleStreamOptions,
  debug?: DebugLogger,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const configuredMaxTokens = options?.maxTokens ?? model.maxTokens;
  const requestedMaxTokens = Number.isFinite(configuredMaxTokens)
    ? Math.max(1, Math.floor(configuredMaxTokens))
    : Math.max(1, Math.floor(model.maxTokens));
  const budget = buildContextBudget(model.contextWindow, requestedMaxTokens, context);
  const initialOptions = { ...options, maxTokens: budget.maxOutputTokens };

  if (budget.wasReduced) {
    debug?.({
      phase: 'preflight',
      model: `${model.provider}/${model.id}`,
      requestedMaxTokens,
      appliedMaxTokens: budget.maxOutputTokens,
      estimatedInputTokens: budget.estimatedInputTokens,
      reserveTokens: budget.reserveTokens,
    });
  }

  void (async () => {
    let attempt = 0;
    let attemptOptions = initialOptions;

    while (attempt < 2) {
      const buffered: AssistantMessageEvent[] = [];
      let emittedIrreversibleOutput = false;
      let retryMaxTokens: number | undefined;

      try {
        const stream = streamSimple(model, context, attemptOptions);
        for await (const event of stream) {
          if (attempt > 0 || emittedIrreversibleOutput) {
            output.push(event);
            continue;
          }

          if (isIrreversibleOutput(event)) {
            emittedIrreversibleOutput = true;
            pushAll(output, buffered);
            buffered.length = 0;
            output.push(event);
            continue;
          }

          if (
            event.type === 'error' &&
            event.reason !== 'aborted' &&
            !attemptOptions.signal?.aborted &&
            isContextOverflow(event.error, model.contextWindow)
          ) {
            retryMaxTokens = calculateOverflowRetryMaxTokens(
              event.error.errorMessage ?? '',
              model.contextWindow,
              attemptOptions.maxTokens ?? requestedMaxTokens,
            );
            if (retryMaxTokens !== undefined) break;
          }

          buffered.push(event);
          if (event.type === 'done' || event.type === 'error') {
            pushAll(output, buffered);
            return;
          }
        }
      } catch (error) {
        const message = createThrownErrorMessage(model, error);
        if (
          attempt === 0 &&
          !emittedIrreversibleOutput &&
          !attemptOptions.signal?.aborted &&
          isContextOverflow(message, model.contextWindow)
        ) {
          retryMaxTokens = calculateOverflowRetryMaxTokens(
            message.errorMessage ?? '',
            model.contextWindow,
            attemptOptions.maxTokens ?? requestedMaxTokens,
          );
        }
        if (retryMaxTokens === undefined || attempt > 0) {
          pushAll(output, buffered);
          output.push({ type: 'error', reason: 'error', error: message });
          return;
        }
      }

      if (retryMaxTokens === undefined) {
        // A malformed provider stream ended without a terminal event. Preserve
        // its lifecycle events and synthesize a terminal error so callers of
        // result() cannot hang indefinitely.
        pushAll(output, buffered);
        output.push({
          type: 'error',
          reason: 'error',
          error: createThrownErrorMessage(model, 'Provider stream ended without a terminal event'),
        });
        return;
      }

      debug?.({
        phase: 'retry',
        model: `${model.provider}/${model.id}`,
        requestedMaxTokens: attemptOptions.maxTokens ?? requestedMaxTokens,
        appliedMaxTokens: retryMaxTokens,
      });
      attempt += 1;
      attemptOptions = { ...attemptOptions, maxTokens: retryMaxTokens };
    }
  })();

  return output;
}

/** Install once on the shared runtime so main and utility sessions are covered. */
export function installContextBudgetGuard(
  runtime: PiModelRuntime,
  debug?: DebugLogger,
): void {
  if (installedRuntimes.has(runtime)) return;
  const original = runtime.streamSimple.bind(runtime) as RuntimeStreamSimple;
  runtime.streamSimple = ((model, context, options) =>
    createContextBudgetedStream(original, model, context, options, debug)) as PiModelRuntime['streamSimple'];
  installedRuntimes.add(runtime);
}
