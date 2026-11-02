import { appendModelRequestRecord, modelRequestRecord } from './model-request-record.ts';
import { PI_SESSION_TOOL_SHORT_NAME_ALIASES } from '../../shared/src/agent/backend/pi/model-visible-tools.ts';
import { boundedModelStream, MODEL_REQUEST_TIMEOUT_MS } from './bounded-model-stream.ts';
import { createRequestDiagnosticScope, runWithRequestDiagnostics, requestDiagnosticDetails, subscribeModelRequestQueue } from '../../shared/src/request-diagnostics.ts';
import { hasModelRequestGate } from '../../shared/src/model-request-gate';
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  isContextOverflow,
  normalizeContext,
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
  contextSystemFingerprint,
  contextToolsFingerprint,
  ACTIONABLE_CONTEXT_OVERFLOW_MESSAGE,
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

type CodexTextPhase = 'commentary' | 'final_answer';

function rememberCodexTextPhase(data: unknown, pendingPhases: Array<CodexTextPhase | undefined>): void {
  if (!data || typeof data !== 'object') return;
  const event = data as { type?: unknown; item?: { type?: unknown; phase?: unknown } };
  if (event.type !== 'response.output_item.added' || event.item?.type !== 'message') return;
  pendingPhases.push(event.item.phase === 'commentary' || event.item.phase === 'final_answer'
    ? event.item.phase
    : undefined);
}

function annotateCodexTextPhase(
  event: AssistantMessageEvent,
  pendingPhases: Array<CodexTextPhase | undefined>,
  phases: Map<number, CodexTextPhase>,
): AssistantMessageEvent {
  if (event.type !== 'text_start' && event.type !== 'text_delta' && event.type !== 'text_end') return event;
  if (event.type === 'text_start') {
    const phase = pendingPhases.shift();
    if (phase) phases.set(event.contentIndex, phase);
  }
  const phase = phases.get(event.contentIndex);
  const part = event.partial.content[event.contentIndex];
  let annotated = event;
  if (phase && part?.type === 'text' && !part.textSignature) {
    const content = [...event.partial.content];
    content[event.contentIndex] = { ...part, textSignature: JSON.stringify({ phase }) };
    annotated = { ...event, partial: { ...event.partial, content } };
  }
  if (event.type === 'text_end') phases.delete(event.contentIndex);
  return annotated;
}

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
  // Keep Agent.state.tools intact: old short-name tool calls must still execute.
  const activeToolNames = new Set(getCurrentTools(normalizeContext(context).messages).map(tool => tool.name));
  const hiddenAliases = new Set<string>(PI_SESSION_TOOL_SHORT_NAME_ALIASES.filter(
    alias => activeToolNames.has(`mcp__session__${alias}`),
  ));
  const visible = <T extends { name: string }>(tools: T[]) => tools.filter(tool => !hiddenAliases.has(tool.name));
  const hasTranscriptTools = hiddenAliases.size > 0 && context.messages.some(message => message.role === 'system' && !!message.toolsAdded?.length);
  context = {
    ...context,
    tools: context.tools ? visible(context.tools) : undefined,
    messages: hasTranscriptTools ? context.messages.map(message => message.role === 'system' && message.toolsAdded
      ? { ...message, toolsAdded: visible(message.toolsAdded) } : message) : context.messages,
  };
  const diagnosticScope = createRequestDiagnosticScope();
  const startedAt = Date.now();
  const withDiagnostic = (message: AssistantMessage): AssistantMessage & { craftTransportDiagnostics: string[] } => ({
    ...message, craftTransportDiagnostics: requestDiagnosticDetails(diagnosticScope),
  });
  const output = createAssistantMessageEventStream();
  const configuredMaxTokens = options?.maxTokens ?? model.maxTokens;
  const requestedMaxTokens = Number.isFinite(configuredMaxTokens)
    ? Math.max(1, Math.floor(configuredMaxTokens))
    : Math.max(1, Math.floor(model.maxTokens));
  const budget = buildContextBudget(model.contextWindow, requestedMaxTokens, context);
  let outcome: 'success' | 'error' | 'cancelled' = 'error';
  let terminalUsage: AssistantMessage['usage'] | undefined;
  const diagnosticSessionDir = process.env.CRAFT_SESSION_DIR;
  const recordCompletion = () => appendModelRequestRecord(diagnosticSessionDir,
    () => modelRequestRecord(diagnosticScope, startedAt, options?.signal?.aborted ? 'cancelled' : outcome, {
      messages: context.messages.length, estimatedInputTokens: budget.estimatedInputTokens,
      systemFingerprint: JSON.stringify({ legacy: contextSystemFingerprint(context), messages: context.messages.filter(message => message.role === 'system') }),
      toolsFingerprint: contextToolsFingerprint(context),
    }, terminalUsage));
  const initialOptions = { ...options, maxTokens: budget.maxOutputTokens };

  // Utility and compaction requests share this guard, even without a task session.
  // A one-token output cap cannot make an already-full input fit.
  if (Number.isFinite(model.contextWindow) && model.contextWindow > 0
    && budget.estimatedInputTokens + budget.reserveTokens + budget.maxOutputTokens > model.contextWindow) {
    const error = { ...createThrownErrorMessage(model, ACTIONABLE_CONTEXT_OVERFLOW_MESSAGE), craftContextLimit: true };
    if (options?.signal?.aborted) {
      error.stopReason = 'aborted';
      error.errorMessage = 'Request cancelled before context preflight completed.';
    }
    recordCompletion();
    output.push({ type: 'error', reason: error.stopReason === 'aborted' ? 'aborted' : 'error', error: withDiagnostic(error) });
    return output;
  }

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

    try {
      while (attempt < 2) {
        const buffered: AssistantMessageEvent[] = [];
        const pendingCodexTextPhases: Array<CodexTextPhase | undefined> = [];
        const codexTextPhases = new Map<number, CodexTextPhase>();
        let emittedIrreversibleOutput = false;
        let retryMaxTokens: number | undefined;
        let lastPartial: AssistantMessage | undefined;
        const failureMessage = (error: unknown): AssistantMessage => ({
          ...(lastPartial ? structuredClone(lastPartial) : createThrownErrorMessage(model, error)),
          stopReason: attemptOptions.signal?.aborted ? 'aborted' : 'error',
          errorMessage: errorText(error),
        });

        try {
          const configuredTimeout = attemptOptions.timeoutMs;
          const timeoutMs = typeof configuredTimeout === 'number' && Number.isFinite(configuredTimeout) && configuredTimeout > 0
            ? Math.min(configuredTimeout, MODEL_REQUEST_TIMEOUT_MS) : MODEL_REQUEST_TIMEOUT_MS;
          const stream = boundedModelStream(
            signal => runWithRequestDiagnostics(diagnosticScope, () => streamSimple(model, context, {
              ...attemptOptions, signal,
              onProviderStreamEvent: model.api === 'openai-codex-responses'
                ? async (data, sourceModel) => {
                    rememberCodexTextPhase(data, pendingCodexTextPhases);
                    await attemptOptions.onProviderStreamEvent?.(data, sourceModel);
                  }
                : attemptOptions.onProviderStreamEvent,
              // SDK wall clocks start before fetch, including host queueing. The
              // cancellable idle bound above owns the deadline once a slot exists.
              timeoutMs: hasModelRequestGate() ? 2_147_483_647 : attemptOptions.timeoutMs,
              // Codex defaults to a persistent WebSocket, which bypasses fetch.
              // Use its supported SSE transport for host-owned request accounting.
              transport: hasModelRequestGate() && model.api === 'openai-codex-responses' ? 'sse' : attemptOptions.transport,
            })),
            attemptOptions.signal, timeoutMs, listener => subscribeModelRequestQueue(diagnosticScope, listener),
          );
          for await (const rawEvent of stream) {
            if (rawEvent.type === 'done') { outcome = 'success'; terminalUsage = rawEvent.message.usage; }
            if (rawEvent.type === 'error') { outcome = rawEvent.reason === 'aborted' ? 'cancelled' : 'error'; terminalUsage = rawEvent.error.usage; }
            const phasedEvent = model.api === 'openai-codex-responses'
              ? annotateCodexTextPhase(rawEvent, pendingCodexTextPhases, codexTextPhases)
              : rawEvent;
            if ('partial' in phasedEvent) lastPartial = phasedEvent.partial;
            const event = phasedEvent.type === 'error' ? { ...phasedEvent, error: withDiagnostic(phasedEvent.error) } : phasedEvent;
            if (attempt > 0 || emittedIrreversibleOutput) {
              output.push(event);
              if (event.type === 'done' || event.type === 'error') return;
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
          const message = withDiagnostic(failureMessage(error));
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
            output.push({ type: 'error', reason: message.stopReason === 'aborted' ? 'aborted' : 'error', error: message });
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
            error: withDiagnostic(failureMessage('Provider stream ended without a terminal event')),
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
    } finally { recordCompletion(); }
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
