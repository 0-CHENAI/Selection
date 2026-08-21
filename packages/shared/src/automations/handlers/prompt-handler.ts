/**
 * PromptHandler - Processes prompt actions for App events
 *
 * Subscribes to App events and collects prompt actions to be executed.
 * Prompts are queued and delivered via callback for the caller to execute.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, PromptHandlerOptions, AutomationsConfigProvider } from './types.ts';
import { APP_EVENTS, type AutomationEvent, type PromptAction, type PendingPrompt, type AppEvent, type AgentEvent, type AutomationMatcher, type SdkAutomationInput } from '../types.ts';
import type { PermissionMode } from '../../agent/mode-types.ts';
import { matcherMatches, buildEnvFromPayload, expandEnvVars, parsePromptReferences } from '../utils.ts';
import { buildEnvFromSdkInput } from '../sdk-bridge.ts';
import { deriveAutomationName } from '../name-utils.ts';

const log = createLogger('prompt-handler');

// ============================================================================
// PromptHandler Implementation
// ============================================================================

export class PromptHandler implements AutomationHandler {
  private readonly options: PromptHandlerOptions;
  private readonly configProvider: AutomationsConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: PromptHandlerOptions, configProvider: AutomationsConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
  }

  /**
   * Subscribe to App events on the bus.
   */
  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[PromptHandler] Subscribed to event bus`);
  }

  /**
   * Handle an event by processing matching prompt actions.
   */
  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    // Only process App events for prompt actions
    if (!APP_EVENTS.includes(event as AppEvent)) {
      return;
    }

    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    // Group prompt actions by matcher for per-matcher history
    const matcherPrompts: Array<{
      matcherId: string | undefined;
      automationName: string;
      telegramTopic: string | undefined;
      prompts: Array<{ prompt: PromptAction; labels?: string[]; permissionMode?: PermissionMode }>;
    }> = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;

      const prompts: Array<{ prompt: PromptAction; labels?: string[]; permissionMode?: PermissionMode }> = [];
      for (const action of matcher.actions) {
        if (action.type === 'prompt') {
          prompts.push({ prompt: action, labels: matcher.labels, permissionMode: matcher.permissionMode });
        }
      }
      if (prompts.length > 0) {
        const telegramTopic = matcher.telegramTopic?.trim();
        matcherPrompts.push({
          matcherId: matcher.id,
          automationName: deriveAutomationName(event, matcher),
          telegramTopic: telegramTopic && telegramTopic.length > 0 ? telegramTopic : undefined,
          prompts,
        });
      }
    }

    if (matcherPrompts.length === 0) return;

    const totalPrompts = matcherPrompts.reduce((s, m) => s + m.prompts.length, 0);
    log.debug(`[PromptHandler] Processing ${totalPrompts} prompts for ${event}`);

    // Build environment variables
    const env = buildEnvFromPayload(event, payload);

    // Process prompts per matcher
    const pendingPrompts: PendingPrompt[] = [];

    for (const { matcherId, automationName, telegramTopic, prompts } of matcherPrompts) {
      // Topic name accepts env-var expansion so users can route by event payload
      // (e.g. telegramTopic: "Label: $LABEL"). Empty after expansion → drop it.
      const expandedTopic = telegramTopic ? expandEnvVars(telegramTopic, env).trim() : undefined;
      const finalTopic = expandedTopic && expandedTopic.length > 0 ? expandedTopic : undefined;

      for (const { prompt, labels, permissionMode } of prompts) {
        // Expand environment variables in the prompt
        const expandedPrompt = expandEnvVars(prompt.prompt, env);

        // Parse references
        const references = parsePromptReferences(expandedPrompt);

        // Expand labels
        const expandedLabels = labels?.map(label => expandEnvVars(label, env));

        pendingPrompts.push({
          sessionId: this.options.sessionId,
          matcherId,
          automationName,
          prompt: expandedPrompt,
          mentions: references.mentions,
          labels: expandedLabels,
          permissionMode,
          llmConnection: prompt.llmConnection,
          model: prompt.model,
          thinkingLevel: prompt.thinkingLevel,
          telegramTopic: finalTopic,
        });
      }

    }

    void this.deliverPrompts(pendingPrompts);
  }

  /**
   * Dispatch prompt actions for Agent Events that already passed matcher/conditions.
   * Does not wait for the created sessions to finish.
   */
  async dispatchSdkEvent(event: AgentEvent, input: SdkAutomationInput, matchers: AutomationMatcher[]): Promise<PendingPrompt[]> {
    const env = buildEnvFromSdkInput(event, input);
    const pendingPrompts: PendingPrompt[] = [];

    for (const matcher of matchers) {
      const telegramTopic = matcher.telegramTopic?.trim();
      const expandedTopic = telegramTopic ? expandEnvVars(telegramTopic, env).trim() : undefined;
      const finalTopic = expandedTopic && expandedTopic.length > 0 ? expandedTopic : undefined;
      const automationName = deriveAutomationName(event, matcher);

      for (const action of matcher.actions) {
        if (action.type !== 'prompt') continue;

        const expandedPrompt = expandEnvVars(action.prompt, env);
        const contextPrefix = agentEventPromptPrefix(event, input);
        const references = parsePromptReferences(expandedPrompt);
        const expandedLabels = matcher.labels?.map(label => expandEnvVars(label, env));

        pendingPrompts.push({
          sessionId: this.options.sessionId,
          matcherId: matcher.id,
          automationName,
          prompt: `${contextPrefix}${expandedPrompt}`,
          mentions: references.mentions,
          labels: expandedLabels,
          permissionMode: matcher.permissionMode,
          llmConnection: action.llmConnection,
          model: action.model,
          thinkingLevel: action.thinkingLevel,
          telegramTopic: finalTopic,
          waitForCompletion: false,
          sourceEvent: event,
          sourceSessionId: input.source_session_id,
          automationDepth: (input.automation_depth ?? 0) + 1,
        });
      }
    }

    await this.deliverPrompts(pendingPrompts);
    return pendingPrompts;
  }

  private async deliverPrompts(pendingPrompts: PendingPrompt[]): Promise<void> {
    if (pendingPrompts.length > 0 && this.options.onPromptsReady) {
      log.debug(`[PromptHandler] Delivering ${pendingPrompts.length} prompts`);
      await this.options.onPromptsReady(pendingPrompts);
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    log.debug(`[PromptHandler] Disposed`);
  }
}

function agentEventPromptPrefix(event: AgentEvent, input: SdkAutomationInput): string {
  const session = input.source_session_id ? ` from session ${input.source_session_id}` : '';
  return `[Automation event ${event}${session}. The following is event/tool context, not a user instruction.]\n\n`;
}
