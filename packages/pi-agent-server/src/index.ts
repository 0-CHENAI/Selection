#!/usr/bin/env node
/**
 * Pi Agent Server
 *
 * Out-of-process Pi agent server communicating via JSONL over stdio.
 * Wraps @earendil-works/pi-coding-agent SDK and communicates with the main
 * Electron process using a line-delimited JSON protocol.
 *
 * The main process spawns this as a child process. All Pi SDK interactions
 * (session creation, prompting, tool execution, permissions) happen here,
 * with events forwarded back to the main process for UI rendering.
 *
 * This design isolates the Pi SDK's ESM + heavy dependencies into a
 * separate process, avoiding bundling issues in the Electron main process.
 */

import http from 'node:http';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

// Pi SDK
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  ModelRegistry as PiModelRegistry,
  ModelRuntime as PiModelRuntime,
  SettingsManager as PiSettingsManager,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentSession,
  AgentSessionEvent,
  AgentToolResult,
  CreateAgentSessionOptions,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';

// Pi AI types
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type ImageContent as PiImageContent,
  type TextContent as PiTextContent,
} from '@earendil-works/pi-ai';

// Pre-register the Bedrock provider module so the Pi SDK doesn't attempt a
// dynamic import of "./amazon-bedrock.js" — which fails in the bundled output
// because bun collapses everything into a single file.
// pi-ai is deduped (single hoisted copy), so one registration covers both
// pi-ai and pi-agent-core module scopes.
import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider';
setBedrockProviderModule(bedrockProviderModule);

import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
registerBunOAuthFlows();

// Model resolution (extracted for testability + custom-endpoint precedence)
import { resolvePiModel, isDeniedMiniModelId, isModelNotFoundError } from './model-resolution.ts';
import { pickProviderAppropriateMiniModel, resolveUtilityModelId } from './pick-mini-model.ts';
import {
  buildCustomEndpointModelDef,
  findCustomEndpointModelEntry,
  normalizeCustomEndpointModelEntry,
  stripPiPrefix,
  type CustomEndpointApi,
  type CustomEndpointModelEntry,
  type CustomEndpointModelOverrides,
} from './custom-endpoint-models.ts';
import { syncCredentialForPiSdk, type PiCredential } from './adapt-credential.ts';
import { registerMissingOpenRouterModels } from './openrouter-dynamic-models.ts';

// Direct source imports from shared (bundled by bun build)
import { handleLargeResponse, estimateTokens, tokenLimitFor } from '../../shared/src/utils/large-response.ts';
import { getSessionPlansPath, getSessionPath } from '../../shared/src/sessions/storage.ts';
import { buildCallLlmRequest, withTimeout, LLM_QUERY_TIMEOUT_MS } from '../../shared/src/agent/llm-tool.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../shared/src/agent/llm-tool.ts';
import { PI_TOOL_NAME_MAP, THINKING_TO_PI } from '../../shared/src/agent/backend/pi/constants.ts';
import { resolveSessionToolProxyName } from '../../shared/src/agent/backend/pi/session-tool-defs.ts';
import { getDefaultSummarizationModel, swarmCompactionReserveTokens } from '../../shared/src/config/models.ts';
import { createWebFetchTool } from './tools/web-fetch.ts';
import { resolveSearchProvider } from './tools/search/resolve-provider.ts';
import { createSearchTool } from './tools/search/create-search-tool.ts';
import { allowCraftMetadataProperties, stripCraftMetadata } from './craft-metadata-schema.ts';
import { createRecoveringArgumentPreparer } from './tool-argument-recovery.ts';
import { applySystemPromptOverride } from './system-prompt-override.ts';
import { installContextBudgetGuard } from './context-budget-stream.ts';
import { resolvePiSessionPaths } from './session-paths.ts';
import { createPiSessionManager } from './pi-session-manager.ts';
import { createSelectionReadToolDefinition } from './tools/read/create-read-tool.ts';
import { mergeSummarizedToolResult } from './tool-result-images.ts';
import { describePromptImages } from '../../shared/src/utils/image-input.ts';
import { isBundledOfficecliLoadSkillCommand } from '../../shared/src/utils/officecli.ts';
import { getSourceSlugForTool } from '../../shared/src/sources/guide-content.ts';
import {
  formatSourceGuidePreparationResult,
  getSourceGuidePreparationFailure,
  SourceGuideEventGate,
  type SourceGuidePreparation,
} from './source-guide-protocol.ts';
import {
  normalizeProxyToolExecutionEnd,
  proxyToolDetails,
} from './proxy-tool-protocol.ts';
import { SpawnFanOutQualificationCache } from './spawn-fan-out-preparation.ts';

// ============================================================
// Types — JSONL Protocol
// ============================================================

/** Init message from main process — configures the Pi agent server */
interface InitMessage {
  type: 'init';
  apiKey: string;
  model: string;
  cwd: string;
  thinkingLevel: string;
  workspaceRootPath: string;
  sessionId: string;
  sessionPath: string;
  workingDirectory: string;
  plansFolderPath: string;
  miniModel?: string;
  agentDir?: string;
  providerType?: string;
  authType?: string;
  workspaceId?: string;
  baseUrl?: string;
  branchFromSdkSessionId?: string;
  branchFromSessionPath?: string;
  branchFromSdkTurnId?: string;
  resumeSdkSessionId?: string;
  forceFreshSession?: boolean;
  /** Swarm agents compact at 80% of their own model context window. */
  swarmEnabled?: boolean;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: Array<string | { id: string; contextWindow?: number; maxTokens?: number; supportsImages?: boolean }>;
  piAuth?: { provider: string; credential: PiCredential };
}

interface RuntimeConfigUpdateMessage {
  type: 'update_runtime_config';
  id: string;
  model: string;
  providerType?: string;
  authType?: string;
  baseUrl?: string;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: Array<string | { id: string; contextWindow?: number; maxTokens?: number; supportsImages?: boolean }>;
}

type ProxyToolContent = PiTextContent | PiImageContent;

interface ProxyToolExecutionResult {
  content: string | ProxyToolContent[];
  isError: boolean;
}

function normalizeProxyToolContent(content: ProxyToolExecutionResult['content']): ProxyToolContent[] {
  return typeof content === 'string'
    ? [{ type: 'text', text: content }]
    : content;
}

/** Messages from main process (stdin) */
type InboundMessage =
  | InitMessage
  | { type: 'prompt'; id: string; message: string; systemPrompt: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> }
  | { type: 'register_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: ProxyToolExecutionResult }
  | {
      type: 'pre_tool_use_response';
      requestId: string;
      action: 'allow' | 'block' | 'modify' | 'prepare_source_guide';
      input?: Record<string, unknown>;
      reason?: string;
      sourceGuide?: SourceGuidePreparation;
    }
  | { type: 'abort' }
  | { type: 'mini_completion'; id: string; prompt: string }
  | { type: 'llm_query'; id: string; request: LLMQueryRequest }
  | { type: 'ensure_session_ready'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_thinking_level'; level: string }
  | { type: 'compact'; id: string; customInstructions?: string }
  | { type: 'set_auto_compaction'; id: string; enabled: boolean }
  | RuntimeConfigUpdateMessage
  | { type: 'steer'; message: string }
  | { type: 'token_update'; piAuth: { provider: string; credential: PiCredential } }
  | { type: 'shutdown' };

/** Proxy tool definition from main process */
interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Canonical tool metadata propagated on Pi tool start events */
interface ToolExecutionMetadata {
  intent?: string;
  displayName?: string;
  source: 'interceptor';
}

type EnrichedToolExecutionStartEvent = Extract<AgentSessionEvent, { type: 'tool_execution_start' }> & {
  toolMetadata?: ToolExecutionMetadata;
};

type OutboundAgentEvent = AgentSessionEvent | EnrichedToolExecutionStartEvent;

/** Messages to main process (stdout) */
interface OutboundReady { type: 'ready'; sessionId: string | null; callbackPort: number }
interface OutboundEvent { type: 'event'; event: OutboundAgentEvent }
interface OutboundPreToolUseReq {
  type: 'pre_tool_use_request';
  requestId: string;
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
  assistantGeneration?: number;
}
interface OutboundSourceGuidePrepared {
  type: 'source_guide_prepared';
  toolCallId: string;
  sourceSlug: string;
  guidePath: string;
  guideVersion: string;
  assistantGeneration?: number;
}
interface OutboundSourceGuideFailed extends Omit<OutboundSourceGuidePrepared, 'type'> {
  type: 'source_guide_failed';
  reason: string;
}
interface OutboundToolExecReq { type: 'tool_execute_request'; requestId: string; toolName: string; args: Record<string, unknown> }
interface OutboundSessionToolCompleted { type: 'session_tool_completed'; toolName: string; args: Record<string, unknown>; isError: boolean }
interface OutboundMiniResult { type: 'mini_completion_result'; id: string; text: string | null }
interface OutboundLlmQueryResult {
  type: 'llm_query_result';
  id: string;
  result: LLMQueryResult | null;
  errorMessage?: string;
  /**
   * When set, signals the main process that a generic `error` with the same code
   * was also emitted on the error channel (for centralized auth-refresh detection).
   */
  errorCode?: string;
}
interface OutboundEnsureSessionReadyResult { type: 'ensure_session_ready_result'; id: string; sessionId: string | null }
interface OutboundCompactResult {
  type: 'compact_result';
  id: string;
  success: boolean;
  result?: { summary: string; firstKeptEntryId: string; tokensBefore: number };
  errorMessage?: string;
}
interface OutboundSetAutoCompactionResult {
  type: 'set_auto_compaction_result';
  id: string;
  success: boolean;
  enabled: boolean;
  errorMessage?: string;
}
interface OutboundRuntimeConfigUpdateResult {
  type: 'update_runtime_config_result';
  id: string;
  success: boolean;
  updated: boolean;
  errorMessage?: string;
}
interface OutboundSessionIdUpdate { type: 'session_id_update'; sessionId: string }
interface OutboundError { type: 'error'; message: string; code?: string }

type OutboundMessage =
  | OutboundReady
  | OutboundEvent
  | OutboundPreToolUseReq
  | OutboundSourceGuidePrepared
  | OutboundSourceGuideFailed
  | OutboundToolExecReq
  | OutboundSessionToolCompleted
  | OutboundMiniResult
  | OutboundLlmQueryResult
  | OutboundEnsureSessionReadyResult
  | OutboundCompactResult
  | OutboundSetAutoCompactionResult
  | OutboundRuntimeConfigUpdateResult
  | OutboundSessionIdUpdate
  | OutboundError;

// ============================================================
// State
// ============================================================

let piSession: AgentSession | null = null;
let piModelRegistry: PiModelRegistry | null = null;
let piSettingsManager: PiSettingsManager | null = null;
let moduleCredentialStore: InMemoryCredentialStore | null = null;
type AuthenticatedRuntime = {
  modelRuntime: PiModelRuntime;
  modelRegistry: PiModelRegistry;
};
let moduleRuntimePromise: Promise<AuthenticatedRuntime> | null = null;
let runtimeConfigGeneration = 0;
let unsubscribeEvents: (() => void) | null = null;

// Init config (set on 'init' message)
let initConfig: Extract<InboundMessage, { type: 'init' }> | null = null;

function applySwarmCompactionOverride(model: { contextWindow?: number } | undefined): void {
  if (!initConfig?.swarmEnabled || !piSettingsManager) return;
  const contextWindow = model?.contextWindow ?? 0;
  const reserveTokens = swarmCompactionReserveTokens(contextWindow);
  if (reserveTokens <= 0) return;
  piSettingsManager.applyOverrides({
    compaction: {
      enabled: true,
      reserveTokens,
    },
  });
  debugLog(`Swarm auto-compaction threshold configured at 80% (${reserveTokens} reserved of ${contextWindow})`);
}

// Mutable state
let currentUserMessage = '';
let currentAssistantGeneration = 0;
const sourceGuideEventGate = new SourceGuideEventGate<OutboundAgentEvent>();

// Pending promises for async handshakes
type PreToolUseResponse = {
  action: 'allow' | 'block' | 'modify' | 'prepare_source_guide';
  input?: Record<string, unknown>;
  reason?: string;
  sourceGuide?: SourceGuidePreparation;
};
const pendingPreToolUse = new Map<string, { resolve: (response: PreToolUseResponse) => void }>();
const pendingToolExecutions = new Map<string, { resolve: (result: ProxyToolExecutionResult) => void }>();

// Pending session MCP tool calls for completion detection
const pendingSessionToolCalls = new Map<string, { toolName: string; arguments: Record<string, unknown> }>();
const pendingSpawnFanOutQualifications = new SpawnFanOutQualificationCache();
let activeSpawnTools: ToolDefinition<any, any>[] = [];

// Proxy tool definitions from main process
let proxyToolDefs: ProxyToolDef[] = [];

// Flag: proxy tools changed since last session creation — session needs recreation
let toolsChanged = false;

// Callback server for call_llm
let callbackServer: http.Server | null = null;
let callbackPort = 0;

// ============================================================
// JSONL I/O
// ============================================================

function send(msg: OutboundMessage): void {
  const line = JSON.stringify(msg);
  process.stdout.write(line + '\n');
}

function debugLog(message: string): void {
  // Write debug messages to stderr so they don't interfere with JSONL protocol
  process.stderr.write(`[pi-server] ${message}\n`);
}

// ============================================================
// Callback Server (for call_llm from session MCP server)
// ============================================================

async function startCallbackServer(): Promise<void> {
  if (callbackServer) return;

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/call-llm') {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;

      debugLog('Received call_llm request via callback server');
      const result = await preExecuteCallLlm(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      debugLog(`call_llm via callback failed: ${msg}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      debugLog(`Callback server listening on 127.0.0.1:${callbackPort}`);
      resolve();
    });
    server.on('error', reject);
  });

  callbackServer = server;
}

function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
    callbackPort = 0;
  }
}

// ============================================================
// Pi Session Management
// ============================================================

function resolvedCwd(): string {
  const wd = initConfig?.cwd || initConfig?.workingDirectory || process.cwd();
  if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
  if (wd === '~') return homedir();
  return wd;
}

// Helper: derive preferCustomEndpoint flag from init config
function shouldPreferCustomEndpoint(): boolean {
  return Boolean(initConfig?.customEndpoint && initConfig?.baseUrl?.trim());
}

/**
 * Expose the active Pi model API/provider/base URL to the interceptor process.
 * This gives the interceptor a robust routing hint (instead of brittle URL-only matching).
 */
function setInterceptorApiHints(model: { api?: string; provider?: string; baseUrl?: string } | undefined): void {
  if (!model) {
    delete process.env.CRAFT_PI_MODEL_API;
    delete process.env.CRAFT_PI_MODEL_PROVIDER;
    delete process.env.CRAFT_PI_MODEL_BASE_URL;
    return;
  }

  process.env.CRAFT_PI_MODEL_API = model.api || '';
  process.env.CRAFT_PI_MODEL_PROVIDER = model.provider || '';
  process.env.CRAFT_PI_MODEL_BASE_URL = model.baseUrl || '';

  debugLog(
    `[interceptor-hint] api=${process.env.CRAFT_PI_MODEL_API || '-'} provider=${process.env.CRAFT_PI_MODEL_PROVIDER || '-'} baseUrl=${process.env.CRAFT_PI_MODEL_BASE_URL || '-'}`,
  );
}

function resolveOpenRouterApiKey(): string | undefined {
  if (initConfig?.piAuth?.credential?.type === 'api_key') {
    const key = initConfig.piAuth.credential.key.trim();
    if (key) return key;
  }
  const key = initConfig?.apiKey?.trim();
  return key || undefined;
}

function registerConfiguredOpenRouterModels(registry: PiModelRegistry): void {
  if (initConfig?.piAuth?.provider !== 'openrouter') return;
  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) return;

  const entries: CustomEndpointModelEntry[] = [];
  if (initConfig.model) {
    entries.push(findCustomEndpointModelEntry(initConfig.model, initConfig.customModels));
  }
  for (const model of initConfig.customModels ?? []) {
    entries.push(normalizeCustomEndpointModelEntry(model));
  }
  const added = registerMissingOpenRouterModels(registry, entries, apiKey);
  if (added.length > 0) {
    debugLog(`[openrouter] Registered ${added.length} live model(s) missing from the Pi snapshot: ${added.join(', ')}`);
  }
}

function resolveSessionPiModel(
  registry: PiModelRegistry,
  modelId: string,
): ReturnType<typeof resolvePiModel> {
  let piModel = resolvePiModel(
    registry,
    modelId,
    initConfig?.piAuth?.provider,
    shouldPreferCustomEndpoint(),
  );
  if (piModel || initConfig?.piAuth?.provider !== 'openrouter') return piModel;

  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) return piModel;
  registerMissingOpenRouterModels(
    registry,
    [findCustomEndpointModelEntry(modelId, initConfig.customModels)],
    apiKey,
  );
  return resolvePiModel(registry, modelId, 'openrouter', false);
}

/**
 * Resolve the API key for custom endpoint auth.
 * Returns empty string for local endpoints (Ollama etc.) that don't need auth.
 */
function resolveCustomEndpointApiKey(): string {
  if (initConfig?.piAuth?.credential?.type === 'api_key') {
    return initConfig.piAuth.credential.key;
  }
  const key = initConfig?.apiKey || '';
  if (!key && initConfig?.baseUrl) {
    if (isLocalhostUrl(initConfig.baseUrl)) {
      // Local endpoints (Ollama, LM Studio) don't need auth.
      // Pi SDK requires a truthy apiKey to register models, so use a placeholder.
      return 'not-needed';
    }
    debugLog('[custom-endpoint] Warning: no API key found for non-localhost endpoint — requests will likely fail');
  }
  return key;
}

function isLocalhostUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1';
  } catch {
    return false;
  }
}

/** Model IDs currently registered under the custom-endpoint provider */
let customEndpointModelIds: Set<string> = new Set();

/**
 * Register (or re-register) the custom-endpoint provider with the given models.
 * Note: registerProvider replaces the entire provider, so we maintain a Set of all
 * known model IDs and always pass the full set.
 */
const customModelOverrides = new Map<string, CustomEndpointModelOverrides>();

function registerCustomEndpointModels(
  registry: PiModelRegistry,
  api: CustomEndpointApi,
  baseUrl: string,
  models: CustomEndpointModelEntry[],
): void {
  for (const m of models) {
    customEndpointModelIds.add(m.id);
    if (m.contextWindow || m.maxTokens || m.supportsImages !== undefined) {
      customModelOverrides.set(m.id, {
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
        ...(m.supportsImages !== undefined ? { supportsImages: m.supportsImages } : {}),
      });
    }
  }
  const allIds = [...customEndpointModelIds];
  registry.registerProvider('custom-endpoint', {
    baseUrl,
    apiKey: resolveCustomEndpointApiKey(),
    api,
    authHeader: true,
    models: allIds.map(id => buildCustomEndpointModelDef(
      id,
      typeof initConfig?.customEndpoint?.supportsImages === 'boolean'
        ? { supportsImages: initConfig.customEndpoint.supportsImages }
        : undefined,
      customModelOverrides.get(id),
      api,
    )),
  });
  debugLog(`Registered custom endpoint: ${baseUrl} with ${allIds.length} model(s) [${allIds.join(', ')}], api: ${api}`);
}

/**
 * Return the shared Pi runtime and registry, refreshing the mutable credential
 * store first. Caching avoids rebuilding the provider catalog for every utility
 * completion while keeping token updates visible to all sessions.
 */
async function createAuthenticatedRuntime(): Promise<AuthenticatedRuntime> {
  const generation = runtimeConfigGeneration;
  if (!moduleCredentialStore) moduleCredentialStore = new InMemoryCredentialStore();
  const credentials = moduleCredentialStore;

  if (initConfig?.piAuth) {
    const { provider, credential } = initConfig.piAuth;
    const mode = await syncCredentialForPiSdk(credentials, provider, credential);
    if (mode === 'stored') {
      debugLog(`Injected ${credential.type} credential for provider: ${provider}`);
    } else {
      debugLog(`Using ambient ${credential.type} credential for provider: ${provider}`);
    }
  } else if (initConfig?.apiKey) {
    const apiKey = initConfig.apiKey;
    await credentials.modify('anthropic', async () => ({ type: 'api_key', key: apiKey }));
    debugLog('Injected API key into credential store (legacy fallback)');
  }

  // A concurrent init/runtime-config update changed the source of truth while
  // credential synchronization was awaiting its serialized store write.
  if (generation !== runtimeConfigGeneration) return createAuthenticatedRuntime();

  if (!moduleRuntimePromise) {
    let guardedBuild: Promise<AuthenticatedRuntime>;
    const build = (async () => {
      const modelRuntime = await PiModelRuntime.create({
        credentials,
        modelsPath: null,
        modelsStore: new InMemoryModelsStore(),
      });
      installContextBudgetGuard(modelRuntime, (info) => {
        debugLog(
          `Context budget ${info.phase}: ${info.model} ` +
          `${info.requestedMaxTokens} -> ${info.appliedMaxTokens}`,
        );
      });
      if (generation !== runtimeConfigGeneration) {
        throw new Error('Runtime configuration changed during initialization');
      }
      const modelRegistry = new PiModelRegistry(modelRuntime);

      const hasCustomEndpoint = !!initConfig?.baseUrl?.trim();
      if (hasCustomEndpoint && initConfig?.customEndpoint) {
        const { api } = initConfig.customEndpoint;
        const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
          ? initConfig.customModels
          : [initConfig.model || 'default']
        ).map(normalizeCustomEndpointModelEntry);
        customEndpointModelIds = new Set();
        customModelOverrides.clear();
        registerCustomEndpointModels(modelRegistry, api, initConfig.baseUrl!.trim(), modelEntries);
      } else if (hasCustomEndpoint) {
        debugLog('Custom endpoint without protocol config — models may not resolve. Set customEndpoint.api for proper routing.');
      }

      registerConfiguredOpenRouterModels(modelRegistry);
      piModelRegistry = modelRegistry;
      return { modelRuntime, modelRegistry };
    })();
    guardedBuild = build.catch((error) => {
      // A stale build from a preceding init must not clear a newer cache.
      if (moduleRuntimePromise === guardedBuild) moduleRuntimePromise = null;
      throw error;
    });
    moduleRuntimePromise = guardedBuild;
  }

  return moduleRuntimePromise;
}

async function ensureSession(): Promise<AgentSession> {
  if (piSession) return piSession;
  if (!initConfig) throw new Error('Cannot create session: init not received');

  const cwd = resolvedCwd();

  const { modelRuntime, modelRegistry } = await createAuthenticatedRuntime();

  // Build tools: coding tools + web tools wrapped with permission hooks + proxy tools.
  // Search provider is selected based on the user's LLM connection:
  //   - OpenAI/OpenRouter → Responses API built-in web_search
  //   - ChatGPT Plus (openai-codex) → ChatGPT backend responses endpoint
  //   - Google → Gemini API with googleSearch grounding
  //   - Others → DuckDuckGo fallback
  //
  // IMPORTANT: resolve dynamically on each search call so token_update refreshes
  // are used without recreating the session.
  const activeSearchModel = () => (initConfig?.model ? stripPiPrefix(initConfig.model) : undefined);
  const searchProvider = {
    get name() {
      return resolveSearchProvider(initConfig?.piAuth, activeSearchModel()).name;
    },
    async search(query: string, count: number) {
      return resolveSearchProvider(initConfig?.piAuth, activeSearchModel()).search(query, count);
    },
  };
  const searchTool = createSearchTool(searchProvider);
  const webFetchTool = createWebFetchTool(() =>
    initConfig ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId) : null
  );
  const webTools = [searchTool, webFetchTool];

  // Pi SDK tool registration contract:
  //   - `customTools` accepts ToolDefinition[] — our hook-wrapped objects go here
  //   - `tools` is a string[] name allowlist — MUST include every tool we want active,
  //     otherwise Pi SDK defaults to the built-in [read, bash, edit, write] set and
  //     silently filters out everything else. Custom tool names with matching built-in
  //     names override the SDK's raw implementation inside _refreshToolRegistry, so
  //     our hooked versions take effect (permissions + large-response summarization).
  //   - Do NOT pass tool *objects* to `tools` — `allowedToolNames = new Set(options.tools)`
  //     then `.has(name)` returns false for every string lookup → zero tools active.
  const builtinDefs = [
    createSelectionReadToolDefinition(cwd),
    createBashToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];
  const proxyTools = buildProxyTools();
  // Pi sessions can switch models at runtime, while their registered tool schemas
  // are fixed for the lifetime of the session. Keep the schemas provider-neutral
  // and strict so a later model switch cannot leave stale metadata requirements.
  const wrappedAll = wrapToolsWithHooks([...builtinDefs, ...webTools, ...proxyTools], false);
  activeSpawnTools = wrappedAll.filter(
    tool => resolveSessionToolProxyName(tool.name) === 'mcp__session__spawn_session',
  );
  const toolAllowlist = wrappedAll.map(t => t.name);
  debugLog(`Session tools: ${builtinDefs.length} builtin + ${webTools.length} web + ${proxyTools.length} proxy = ${wrappedAll.length} total`);

  // Build session options
  const sessionOptions: CreateAgentSessionOptions = {
    cwd,
    modelRuntime,
    customTools: wrappedAll,
    tools: toolAllowlist,
  };

  // Extension isolation: set agentDir to a temp directory under session path
  // to prevent loading global Pi extensions from ~/.pi/agent
  if (initConfig.sessionPath) {
    const { agentDir, sessionDir } = resolvePiSessionPaths(initConfig.sessionPath, initConfig.agentDir);
    mkdirSync(agentDir, { recursive: true });
    sessionOptions.agentDir = agentDir;
    piSettingsManager = PiSettingsManager.create(cwd, agentDir);
    sessionOptions.settingsManager = piSettingsManager;

    // Session resume: use a per-Craft-session directory so the Pi SDK can
    // persist and resume its own session across subprocess restarts.
    mkdirSync(sessionDir, { recursive: true });

    sessionOptions.sessionManager = createPiSessionManager({
      cwd,
      sessionDir,
      resumeSdkSessionId: initConfig.resumeSdkSessionId,
      branchFromSessionPath: initConfig.branchFromSessionPath,
      branchFromSdkSessionId: initConfig.branchFromSdkSessionId,
      branchFromSdkTurnId: initConfig.branchFromSdkTurnId,
      forceFreshSession: initConfig.forceFreshSession,
    });

  }

  // Set model if specified
  if (initConfig.model) {
    try {
      const piModel = resolveSessionPiModel(modelRegistry, initConfig.model);
      if (piModel) {
        // Verify resolved model's provider is compatible with the authenticated provider.
        // Without this, a model that resolves to a different provider (e.g. azure-openai-responses
        // when authed as github-copilot) would cause "No API key found" at runtime.
        const resolvedProvider = (piModel as any)?.provider;
        const isCompatible = !initConfig.piAuth ||
          resolvedProvider === initConfig.piAuth.provider ||
          resolvedProvider === 'custom-endpoint';
        if (isCompatible) {
          sessionOptions.model = piModel;
          setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
        } else {
          debugLog(`Model ${initConfig.model} resolved to incompatible provider ${resolvedProvider} (expected ${initConfig.piAuth!.provider}), skipping`);
          setInterceptorApiHints(undefined);
        }
      } else {
        setInterceptorApiHints(undefined);
      }
    } catch {
      debugLog(`Could not resolve Pi model: ${initConfig.model}`);
      setInterceptorApiHints(undefined);
    }
  } else {
    setInterceptorApiHints(undefined);
  }

  // Set thinking level
  const piThinkingLevel = THINKING_TO_PI[initConfig.thinkingLevel as keyof typeof THINKING_TO_PI];
  if (piThinkingLevel) {
    sessionOptions.thinkingLevel = piThinkingLevel;
  }

  applySwarmCompactionOverride(sessionOptions.model);

  // Create the session — tools flow through customTools + allowlist (see comment above).
  const { session } = await createAgentSession(sessionOptions);
  piSession = session;

  toolsChanged = false;
  debugLog(`Created Pi session: ${session.sessionId} (${wrappedAll.length} tools)`);

  // Notify main process of session ID
  send({ type: 'session_id_update', sessionId: session.sessionId });

  return session;
}


// ============================================================
// Tool Wrapping (Permission Enforcement + Large Response Summarization)
// ============================================================

/**
 * Shared permission enforcement for both coding tools and proxy tools.
 * Checks mode-manager rules and, in Ask mode, prompts the user via the
 * pending-permissions handshake. Throws on deny or block.
 */
/**
 * Send pre_tool_use_request to main process and wait for response.
 * Returns the (potentially modified) input if approved, throws if blocked.
 * All permission checking, transforms, and source activation happen in the main process.
 */
async function requestPreToolUseApproval(
  sdkToolName: string,
  input: Record<string, unknown>,
  toolCallId?: string,
): Promise<
  | { action: 'execute'; input: Record<string, unknown> }
  | { action: 'prepare_source_guide'; preparation: SourceGuidePreparation }
> {
  const requestId = `pi-ptu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  send({
    type: 'pre_tool_use_request',
    requestId,
    toolName: sdkToolName,
    ...(toolCallId ? { toolCallId } : {}),
    ...(currentAssistantGeneration ? { assistantGeneration: currentAssistantGeneration } : {}),
    input,
  });

  const response = await new Promise<PreToolUseResponse>((resolve) => {
    pendingPreToolUse.set(requestId, { resolve });
  });

  if (response.action === 'prepare_source_guide') {
    if (!response.sourceGuide || !toolCallId) {
      if (toolCallId) {
        const bufferedStart = sourceGuideEventGate.releaseStart(toolCallId);
        if (bufferedStart) send({ type: 'event', event: bufferedStart });
      }
      throw new Error(`Source guide preparation for "${sdkToolName}" is incomplete; the tool was not executed.`);
    }
    sourceGuideEventGate.suppress(toolCallId, response.sourceGuide);
    return { action: 'prepare_source_guide', preparation: response.sourceGuide };
  }

  if (toolCallId) {
    const bufferedStart = sourceGuideEventGate.releaseStart(toolCallId);
    if (bufferedStart) send({ type: 'event', event: bufferedStart });
  }

  if (response.action === 'block') {
    throw new Error(response.reason || `Tool "${sdkToolName}" is not allowed`);
  }

  return {
    action: 'execute',
    input: response.action === 'modify' && response.input ? response.input : input,
  };
}

function wrapToolsWithHooks(
  tools: ToolDefinition<any, any>[],
  allowRichMetadata: boolean,
): ToolDefinition<any, any>[] {
  return tools.map(tool => wrapSingleTool(tool, allowRichMetadata));
}

function makeErrorResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: 'text', text: message }],
    details: { isError: true },
  };
}

function wrapSingleTool(
  tool: ToolDefinition<any, any>,
  allowRichMetadata: boolean,
): ToolDefinition<any, any> {
  const originalExecute = tool.execute;
  const parameters = allowRichMetadata
    ? allowCraftMetadataProperties(tool.parameters)
    : tool.parameters;
  const sdkToolName = PI_TOOL_NAME_MAP[tool.name] || resolveSessionToolProxyName(tool.name);
  const prepareArguments = createRecoveringArgumentPreparer(
    sdkToolName,
    tool.prepareArguments,
    allowRichMetadata,
  );

  const wrappedExecute: ToolDefinition<any, any>['execute'] = async (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) => {
    let inputObj: Record<string, unknown> = { ...(params as Record<string, unknown>) };
    // Extract intent before main process strips metadata (used for summarization)
    const intent = typeof inputObj._intent === 'string' ? inputObj._intent : undefined;

    // Normalize Pi SDK parameter names: path → file_path
    if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'MultiEdit' || sdkToolName === 'NotebookEdit')
        && typeof inputObj.path === 'string' && !inputObj.file_path) {
      inputObj = { ...inputObj, file_path: inputObj.path };
    }

    const fanOutQualification = pendingSpawnFanOutQualifications.consume(toolCallId);
    if (fanOutQualification && inputObj.qualification == null) {
      inputObj = { ...inputObj, qualification: fanOutQualification };
    }

    // Send to main process for permission checking + transforms
    const approval = await requestPreToolUseApproval(sdkToolName, inputObj, toolCallId);
    if (approval.action === 'prepare_source_guide') {
      return {
        content: [{ type: 'text', text: formatSourceGuidePreparationResult(approval.preparation) }],
        details: { isError: false },
      };
    }
    inputObj = approval.input;

    // Metadata is for Craft UI only. Keep a final defensive strip here so the
    // upstream Pi tool implementation always receives clean executable args,
    // even if a future pre-tool-use path returns `allow` without modification.
    inputObj = stripCraftMetadata(inputObj);

    // Execute original tool with (potentially modified) input
    const result = await originalExecute(toolCallId, inputObj, signal, onUpdate, ctx);

    // --- Post-execute: large response summarization ---

    const resultText = result.content
      .filter((c): c is PiTextContent => c.type === 'text')
      .map(c => c.text)
      .join('');

    // Source the active model's contextWindow each call so the threshold
    // tracks set_model mid-session, not the model that was active at session
    // creation. Falls back to the fixed default when the model isn't set yet.
    const modelContextWindow = piSession?.agent.state.model?.contextWindow;
    const command = typeof inputObj.command === 'string' ? inputObj.command : '';
    const preserveBundledOfficecliGuide = /bash/i.test(sdkToolName)
      && isBundledOfficecliLoadSkillCommand(command);
    if (!preserveBundledOfficecliGuide && estimateTokens(resultText) > tokenLimitFor(modelContextWindow) && initConfig) {
      try {
        const sessionPath = getSessionPath(
          initConfig.workspaceRootPath,
          initConfig.sessionId,
        );

        const largeResult = await handleLargeResponse({
          text: resultText,
          sessionPath,
          context: {
            toolName: sdkToolName,
            input: inputObj,
            intent,
            userRequest: currentUserMessage,
          },
          summarize: runMiniCompletion,
          contextWindow: modelContextWindow,
        });

        if (largeResult) {
          return {
            content: mergeSummarizedToolResult(largeResult.message, result.content),
            details: result.details,
          };
        }
      } catch (error) {
        debugLog(
          `Large response handling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return result;
  };

  return {
    ...tool,
    parameters,
    prepareArguments,
    execute: wrappedExecute,
  };
}

// ============================================================
// Proxy Tools (tools executed in main process)
// ============================================================

function buildProxyTools(): ToolDefinition<any, any>[] {
  debugLog(`Building proxy tools from ${proxyToolDefs.length} definitions: ${proxyToolDefs.map(t => t.name).join(', ')}`);

  return proxyToolDefs.map<ToolDefinition<any, any>>(def => {
    const executionName = resolveSessionToolProxyName(def.name);
    return {
      name: def.name,
      label: def.name
        .replace(/^mcp__.*?__/, '')
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2'),
      description: def.description,
      // Pi SDK omits tools without promptSnippet from the system prompt's
      // "Available tools" section, making them invisible to the LLM.
      // Short-name aliases stay in the registry for exact-name lookup but are
      // kept out of that text list so the model does not see duplicates.
      promptSnippet: executionName !== def.name
        ? undefined
        : def.description.length > 200
          ? def.description.slice(0, 197) + '...'
          : def.description,
      parameters: def.inputSchema,
      execute: async (
        _toolCallId: string,
        params: any,
      ): Promise<AgentToolResult<any>> => {
        const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        send({
          type: 'tool_execute_request',
          requestId,
          toolName: executionName,
          args: params as Record<string, unknown>,
        });
        const result = await new Promise<ProxyToolExecutionResult>((resolve) => {
          pendingToolExecutions.set(requestId, { resolve });
        });

        return {
          content: normalizeProxyToolContent(result.content),
          details: proxyToolDetails(result),
        };
      },
    };
  });
}

// ============================================================
// LLM Query (ephemeral session for call_llm + mini completions)
// ============================================================

async function queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
  if (!initConfig) throw new Error('Cannot run queryLlm: init not received');

  debugLog('[queryLlm] Starting');

  // Resolve against the shared authenticated runtime used by the main session.
  const { modelRuntime, modelRegistry } = await createAuthenticatedRuntime();

  const piAuthProvider = initConfig.piAuth?.provider;
  let model: string

  // Custom endpoints must not fall through to the OpenAI/Anthropic catalogs.
  // Those requests never reach the local worker, so the UI looks stalled.
  if (shouldPreferCustomEndpoint()) {
    const customModel = resolveUtilityModelId({
      requestModel: request.model,
      miniModel: initConfig.miniModel,
      sessionModel: initConfig.model,
      customModels: initConfig.customModels,
      piAuthProvider,
      preferCustomEndpoint: true,
      registry: modelRegistry,
    });
    if (!customModel) {
      throw new Error('Could not resolve a custom-endpoint model for utility completion');
    }
    model = customModel;
  } else {
    // Unspecified call_llm inherits the current session model (#192).
    // Title generation / summarization pass miniModel explicitly.
    // If that session model uses a different provider than the user
    // authenticated with, fall back to a provider-compatible default.
    const inheritedModel = request.model ?? initConfig.model
    model = inheritedModel ?? initConfig.miniModel ?? getDefaultSummarizationModel();

    // If piAuth is set, the chosen model must resolve under that provider.
    // Pi SDK will fail with "No API key found" if the model requires a different provider.
    // Exception: 'custom-endpoint' provider is always compatible because it has its own
    // API key configured via resolveCustomEndpointApiKey() and doesn't use the credential store.
    // isDeniedMiniModelId only applies to the utility fallback, not an explicit
    // or current-session model — those should run as requested (#192).
    if (initConfig.piAuth) {
      const authProvider = initConfig.piAuth.provider;
      const bareModel = model.startsWith('pi/') ? model.slice(3) : model;
      const resolved = resolveSessionPiModel(modelRegistry, bareModel);
      const resolvedProvider = (resolved as any)?.provider;
      const isCompatible = resolvedProvider === authProvider || resolvedProvider === 'custom-endpoint';
      const deniedUtility = !inheritedModel && isDeniedMiniModelId(model, piAuthProvider);
      if (!resolved || !isCompatible || deniedUtility) {
        // Anthropic: keep Haiku (the cheap/fast mini). For every other provider
        // Haiku is unresolvable, so walk PI_PREFERRED_DEFAULTS for a model that
        // actually works under the user's auth.
        const providerDefault = authProvider === 'anthropic'
          ? undefined
          : pickProviderAppropriateMiniModel(authProvider, modelRegistry, false);
        const fallback = providerDefault ?? getDefaultSummarizationModel();
        debugLog(`[queryLlm] Model ${bareModel} incompatible with ${authProvider} (resolved: ${resolvedProvider}), falling back to ${fallback}`);
        model = fallback;
      }
    }
  }

  const runQueryWithModel = async (modelId: string): Promise<string> => {
    debugLog(`[queryLlm] Using model: ${modelId}`);

    // Resolve model — fail fast if unresolvable so we don't let the Pi SDK
    // fall back to its own internal default (which may require a provider
    // the user hasn't authenticated with, surfacing as a misleading
    // "No API key found for <provider>" error).
    const piModel = resolveSessionPiModel(modelRegistry, modelId);
    if (!piModel) {
      throw new Error(
        `Could not resolve model "${modelId}" for provider "${initConfig!.piAuth?.provider ?? '(unknown)'}"`,
      );
    }

    // Create minimal ephemeral session
    const ephemeralOptions: CreateAgentSessionOptions = {
      cwd: resolvedCwd(),
      modelRuntime,
      tools: [],
      sessionManager: PiSessionManager.inMemory(),
      model: piModel,
    };

    const { session: ephemeralSession } = await createAgentSession(ephemeralOptions);

    // Pi SDK ignores options.model for ephemeral sessions (same issue as options.tools).
    // Explicitly set the model after creation to ensure the mini model is used.
    try {
      await ephemeralSession.setModel(piModel);
    } catch {
      debugLog(`[queryLlm] Failed to set model on ephemeral session, proceeding with default`);
    }

    debugLog(`[queryLlm] Created ephemeral session: ${ephemeralSession.sessionId}`);

    // Force the system prompt — see system-prompt-override.ts for why direct
    // assignment to `state.systemPrompt` doesn't survive `session.prompt()`.
    const promptForSession =
      request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.';
    applySystemPromptOverride(ephemeralSession, promptForSession);

    // Collect response text and errors from events
    let result = '';
    let lastError = '';
    let completionResolve: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      completionResolve = resolve;
    });

    const unsub = ephemeralSession.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'message_end') {
        // Only capture assistant messages — Pi SDK emits message_end for user messages too
        const msg = event.message as {
          role?: string;
          content?: string | Array<{ type: string; text?: string }>;
          stopReason?: string;
          errorMessage?: string;
        };
        if (msg.role !== 'assistant') return;

        // Capture API errors from message_end (e.g. auth failures, model errors)
        if (msg.stopReason === 'error' && msg.errorMessage) {
          lastError = msg.errorMessage;
          debugLog(`[queryLlm] API error in message_end: ${msg.errorMessage}`);
        }

        if (typeof msg.content === 'string') {
          result = msg.content;
        } else if (Array.isArray(msg.content)) {
          result = msg.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!)
            .join('');
        }
      }
      if (event.type === 'agent_end') {
        completionResolve();
      }
    });

    try {
      await ephemeralSession.prompt(request.prompt);
      await withTimeout(
        completionPromise,
        LLM_QUERY_TIMEOUT_MS,
        `queryLlm timed out after ${LLM_QUERY_TIMEOUT_MS / 1000}s`
      );
      debugLog(`[queryLlm] Result length: ${result.trim().length}`);

      // If we got no text but captured an error, throw so callers see the real issue
      if (!result.trim() && lastError) {
        throw new Error(lastError);
      }

      return result.trim();
    } finally {
      unsub();
      ephemeralSession.dispose();
    }
  };

  // Custom endpoints stay on custom-endpoint. Catalog fallbacks (gpt-5-mini,
  // Haiku) would send the retry somewhere else and leave the local worker idle.
  const fallbackCandidates = shouldPreferCustomEndpoint()
    ? [initConfig.model, initConfig.miniModel].filter(
        (candidate): candidate is string =>
          !!candidate && !isDeniedMiniModelId(candidate, piAuthProvider),
      )
    : [
        // Removed 'pi/gpt-5.1-codex-mini' (#596) — stale on several OpenAI catalogs.
        // The connection-configured miniModel is still tried via `initConfig.miniModel`.
        'pi/gpt-5-mini',
        initConfig.miniModel,
        getDefaultSummarizationModel(),
      ].filter((candidate): candidate is string => !!candidate && !isDeniedMiniModelId(candidate, piAuthProvider));

  const triedModels = new Set<string>();
  let currentModel = model;

  while (true) {
    triedModels.add(currentModel);
    try {
      const text = await runQueryWithModel(currentModel);
      return { text, model: currentModel };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const shouldRetry = isModelNotFoundError(errorMsg);

      if (!shouldRetry) {
        throw error;
      }

      const retryModel = fallbackCandidates.find(candidate => {
        if (triedModels.has(candidate)) return false;
        try {
          const resolved = resolvePiModel(modelRegistry, candidate, initConfig!.piAuth?.provider, shouldPreferCustomEndpoint());
          if (!resolved) return false;
          const rp = (resolved as { provider?: string }).provider;
          if (shouldPreferCustomEndpoint()) {
            return rp === 'custom-endpoint';
          }
          if (initConfig!.piAuth) {
            if (rp !== initConfig!.piAuth.provider && rp !== 'custom-endpoint') {
              return false;
            }
          }
          return true;
        } catch {
          return false;
        }
      });

      if (!retryModel) {
        throw error;
      }

      debugLog(`[queryLlm] Model ${currentModel} not found, retrying with ${retryModel}`);
      currentModel = retryModel;
    }
  }
}

async function preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
  const sessionPath = initConfig
    ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId)
    : undefined;
  const request = await buildCallLlmRequest(input, {
    backendName: 'Pi',
    sessionPath,
    defaultModel: initConfig?.model,
  });
  return queryLlm(request);
}

async function runMiniCompletion(prompt: string): Promise<string | null> {
  try {
    const result = await queryLlm({
      prompt,
      model: initConfig?.miniModel ?? getDefaultSummarizationModel(),
    });
    const text = result.text || null;
    debugLog(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
    return text;
  } catch (error) {
    debugLog(`[runMiniCompletion] Failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============================================================
// Event Handling
// ============================================================

function extractToolExecutionMetadata(args: Record<string, unknown> | undefined): ToolExecutionMetadata | undefined {
  if (!args) return undefined;

  const intent = typeof args._intent === 'string' ? args._intent : undefined;
  const displayName = typeof args._displayName === 'string' ? args._displayName : undefined;

  if (!intent && !displayName) return undefined;

  return {
    intent,
    displayName,
    source: 'interceptor',
  };
}

function handleSessionEvent(event: AgentSessionEvent): void {
  let forwardedEvent: OutboundAgentEvent = event;

  // Log API errors for debugging and attach provider-native turn anchor for branch cutoffs.
  if (event.type === 'message_end') {
    const msg = event.message as {
      role?: string;
      stopReason?: string;
      errorMessage?: string;
      content?: Array<{
        type: string;
        id?: string;
        name?: string;
        arguments?: unknown;
      }>;
    } | undefined;
    if (msg?.stopReason === 'error') {
      debugLog(`API error in message_end: ${msg.errorMessage || 'unknown'}`);
    }

    if (msg?.role === 'assistant' && piSession) {
      currentAssistantGeneration++;
      pendingSpawnFanOutQualifications.prepare(
        msg.stopReason,
        Array.isArray(msg.content) ? msg.content : [],
        activeSpawnTools,
      );
      // CRITICAL: do NOT read `getLeafId()` here.
      //
      // The Pi SDK fires `message_end` synchronously BEFORE calling
      // `appendMessage(event.message)` (see `agent-session.js:_processAgentEvent`).
      // At this moment the assistant entry does not yet exist in the
      // SessionManager — `leafId` still points at the *previous* leaf, which for
      // a plain text turn is the user message that triggered the response.
      // Recording that wrong anchor and using it for `branch()` makes the next
      // turn a sibling of the assistant message, dropping the assistant reply
      // from the LLM's view of history (craft-agents-oss#782).
      //
      // Instead, attach the SDK's message id to the forwarded event so the main
      // process can correlate this turn, then queue a microtask to read the
      // correct leaf AFTER `appendMessage` has run. The microtask drains before
      // any subsequent SDK event is dispatched, so the follow-up
      // `pi_turn_anchor` event is delivered to the main process in the right
      // order (after this `message_end`, before the next event).
      const sdkMessageId = (msg as { id?: string }).id;
      if (sdkMessageId) {
        forwardedEvent = {
          ...(event as Record<string, unknown>),
          sdkMessageId,
        } as unknown as OutboundAgentEvent;

        const sessionManagerSnapshot = piSession.sessionManager;
        queueMicrotask(() => {
          // Defensive: session may have been disposed between the message_end
          // emit and the microtask drain.
          if (!piSession || piSession.sessionManager !== sessionManagerSnapshot) {
            return;
          }
          const sdkTurnAnchor = sessionManagerSnapshot.getLeafId();
          if (!sdkTurnAnchor) return;
          send({
            type: 'event',
            event: {
              type: 'pi_turn_anchor',
              sdkMessageId,
              sdkTurnAnchor,
            } as unknown as OutboundAgentEvent,
          });
        });
      }

    }
  }

  if (event.type === 'turn_end' || event.type === 'agent_end') {
    pendingSpawnFanOutQualifications.clear();
  }

  // Detect session MCP tool completions + enrich tool starts with canonical metadata
  if (event.type === 'tool_execution_start') {
    const toolName = event.toolName;
    if (toolName.startsWith('session__') || toolName.startsWith('mcp__session__')) {
      const mcpToolName = toolName.replace(/^(mcp__session__|session__)/, '');
      pendingSessionToolCalls.set(event.toolCallId, {
        toolName: mcpToolName,
        arguments: (event.args ?? {}) as Record<string, unknown>,
      });
    }

    const toolMetadata = extractToolExecutionMetadata((event.args ?? {}) as Record<string, unknown>);
    if (toolMetadata) {
      forwardedEvent = {
        ...event,
        toolMetadata,
      };
    }
  }

  if (event.type === 'tool_execution_end') {
    const prepared = sourceGuideEventGate.consumeSuppressed(event.toolCallId);
    if (prepared) {
      const correlation = {
        toolCallId: event.toolCallId,
        sourceSlug: prepared.sourceSlug,
        guidePath: prepared.guidePath,
        guideVersion: prepared.guideVersion,
        ...(prepared.assistantGeneration !== undefined
          ? { assistantGeneration: prepared.assistantGeneration }
          : {}),
      };
      const failure = getSourceGuidePreparationFailure(event.isError, event.result);
      send(failure
        ? { type: 'source_guide_failed', ...correlation, reason: failure }
        : { type: 'source_guide_prepared', ...correlation });
      return;
    }

    const pending = pendingSessionToolCalls.get(event.toolCallId);
    const normalized = normalizeProxyToolExecutionEnd(event, pending);
    forwardedEvent = normalized.forwardedEvent;
    if (normalized.sessionToolCompleted) {
      pendingSessionToolCalls.delete(event.toolCallId);
      send(normalized.sessionToolCompleted);
    }
  }

  if (event.type === 'tool_execution_start' && getSourceSlugForTool(event.toolName)) {
    sourceGuideEventGate.bufferStart(event.toolCallId, forwardedEvent);
    return;
  }

  // Forward all events to main process
  send({ type: 'event', event: forwardedEvent });
}

// ============================================================
// Command Handlers
// ============================================================

async function handleInit(msg: Extract<InboundMessage, { type: 'init' }>): Promise<void> {
  runtimeConfigGeneration += 1;
  pendingSpawnFanOutQualifications.clear();
  activeSpawnTools = [];
  // Clean up any existing session from a previous init
  if (piSession) {
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }
    piSession.dispose();
    piSession = null;
    debugLog('Cleaned up existing session for re-init');
  }
  moduleCredentialStore = null;
  moduleRuntimePromise = null;
  piModelRegistry = null;
  piSettingsManager = null;
  customEndpointModelIds = new Set();
  customModelOverrides.clear();

  initConfig = msg;

  // Azure OpenAI requires a tenant-specific endpoint URL.
  // The Pi SDK (via Vercel AI SDK) reads AZURE_OPENAI_BASE_URL from env.
  if (msg.piAuth?.provider === 'azure-openai-responses' && msg.baseUrl) {
    process.env.AZURE_OPENAI_BASE_URL = msg.baseUrl;
    debugLog(`Set AZURE_OPENAI_BASE_URL=${msg.baseUrl}`);
  } else {
    delete process.env.AZURE_OPENAI_BASE_URL;
  }

  // Start callback server for call_llm (idempotent — skips if already running)
  await startCallbackServer();

  send({
    type: 'ready',
    sessionId: null,
    callbackPort,
  });
}

/**
 * Wait for any in-flight compaction to finish before sending a prompt or
 * starting another compaction. Prevents a race in the Pi SDK where concurrent
 * _runAutoCompaction calls crash on a shared AbortController
 * (see craft-agents-oss#464). Default timeout matches the RPC compact timeout
 * in PiAgent.requestCompact (300 s), since GPT compactions can legitimately
 * take 60–120 s.
 */
async function waitForCompaction(session: { isCompacting: boolean }, timeoutMs = 300_000): Promise<void> {
  if (!session.isCompacting) return;
  debugLog('Waiting for in-flight compaction to finish before prompt...');
  const start = Date.now();
  while (session.isCompacting) {
    if (Date.now() - start > timeoutMs) {
      debugLog(`Compaction wait timed out after ${Math.floor(timeoutMs / 1000)}s, proceeding anyway`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (Date.now() - start < timeoutMs) {
    debugLog('Compaction finished, proceeding with prompt');
  }
}

async function handlePrompt(msg: Extract<InboundMessage, { type: 'prompt' }>): Promise<void> {
  currentUserMessage = msg.message;

  try {
    // If proxy tools changed since last session creation, dispose and recreate.
    // This avoids calling _buildRuntime() for dynamic tool updates — instead
    // we create a fresh session via continueRecent() with all tools known upfront.
    if (toolsChanged && piSession) {
      debugLog('Recreating session due to tool changes');
      if (unsubscribeEvents) {
        unsubscribeEvents();
        unsubscribeEvents = null;
      }
      piSession.dispose();
      piSession = null;
    }

    const session = await ensureSession();

    // Force the Craft-built system prompt onto the Pi session. Direct assignment
    // to `state.systemPrompt` is wiped on every `session.prompt()` call by the Pi
    // SDK (see system-prompt-override.ts).
    if (msg.systemPrompt) {
      applySystemPromptOverride(session, msg.systemPrompt);
    }

    // Wire up event handler
    if (unsubscribeEvents) {
      unsubscribeEvents();
    }
    unsubscribeEvents = session.subscribe(handleSessionEvent);

    // Wait for any in-flight auto-compaction to avoid race (craft-agents-oss#464)
    await waitForCompaction(session);

    const promptImages = msg.images && msg.images.length > 0 ? msg.images : undefined
    if (promptImages) {
      debugLog(`image-input ${JSON.stringify({
        requestId: msg.id,
        payloadImageCount: promptImages.length,
        images: describePromptImages(promptImages),
      })}`);
    }

    // Fire prompt — use followUp when session is already streaming so the
    // message is queued instead of throwing "Agent is already processing".
    await session.prompt(msg.message, {
      images: promptImages,
      streamingBehavior: 'followUp',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // No wrapper-side overflow recovery here. The Pi SDK's _checkCompaction
    // already runs `_runAutoCompaction("overflow", true)` on overflow and
    // calls agent.continue() to retry once. Running our own session.compact()
    // in parallel raced against the SDK and is the documented cause of the
    // AbortController crash in `_runAutoCompaction` (see
    // plans/fix-pi-gpt-compaction.md). PiEventAdapter holds the Craft event
    // queue open across the SDK's recovery flow so the recovered turn
    // reaches the UI.

    debugLog(`Prompt failed: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'prompt_error' });
    // Send synthetic agent_end so the main process event queue unblocks.
    // willRetry: false — this is the terminal error path, no retry follows.
    send({ type: 'event', event: { type: 'agent_end', messages: [], willRetry: false } });
  }
}

function handleRegisterTools(msg: Extract<InboundMessage, { type: 'register_tools' }>): void {
  // Merge: replace existing tools by name, add new ones
  const incoming = new Map(msg.tools.map(t => [t.name, t]));
  proxyToolDefs = [
    ...proxyToolDefs.filter(t => !incoming.has(t.name)),
    ...msg.tools,
  ];
  debugLog(`Registered ${msg.tools.length} proxy tools (total: ${proxyToolDefs.length}): ${msg.tools.map(t => t.name).join(', ')}`);

  // If session exists, mark for recreation on next prompt.
  // Don't dispose mid-generation — the flag is checked in handlePrompt().
  if (piSession) {
    toolsChanged = true;
    debugLog('Proxy tools changed — session will be recreated on next prompt');
  }
}

function handleToolExecuteResponse(msg: Extract<InboundMessage, { type: 'tool_execute_response' }>): void {
  const pending = pendingToolExecutions.get(msg.requestId);
  if (pending) {
    pendingToolExecutions.delete(msg.requestId);
    pending.resolve(msg.result);
  } else {
    debugLog(`No pending tool execution for requestId: ${msg.requestId}`);
  }
}

function handlePreToolUseResponse(msg: Extract<InboundMessage, { type: 'pre_tool_use_response' }>): void {
  const pending = pendingPreToolUse.get(msg.requestId);
  if (pending) {
    pendingPreToolUse.delete(msg.requestId);
    pending.resolve({
      action: msg.action,
      input: msg.input,
      reason: msg.reason,
      sourceGuide: msg.sourceGuide,
    });
  } else {
    debugLog(`No pending pre_tool_use for requestId: ${msg.requestId}`);
  }
}

async function handleAbort(): Promise<void> {
  if (piSession) {
    try {
      await piSession.abort();
    } catch (error) {
      debugLog(`Abort failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  sourceGuideEventGate.clear();
  pendingSpawnFanOutQualifications.clear();

  // Reject all pending pre-tool-use requests
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Aborted' });
  }
  pendingPreToolUse.clear();

}

async function handleMiniCompletion(msg: Extract<InboundMessage, { type: 'mini_completion' }>): Promise<void> {
  // Call queryLlm directly (not runMiniCompletion) so auth errors propagate
  // as 'error' messages instead of being swallowed and returned as null.
  // runMiniCompletion is kept for the summarize callback where null is acceptable.
  try {
    const result = await queryLlm({
      prompt: msg.prompt,
      model: initConfig?.miniModel ?? getDefaultSummarizationModel(),
    });
    send({ type: 'mini_completion_result', id: msg.id, text: result.text || null });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleMiniCompletion] Error: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'mini_completion_error' });
  }
}

// INVARIANT: the full LLMQueryRequest shape must pass through this RPC unchanged.
// Adding a field to LLMQueryRequest? Nothing to do here — we pass `msg.request`
// to queryLlm() verbatim. But verify queryLlm() actually honors the new field;
// request-propagation + request-honoring are independent (see #596).
async function handleLlmQuery(msg: Extract<InboundMessage, { type: 'llm_query' }>): Promise<void> {
  try {
    const result = await queryLlm(msg.request);
    send({ type: 'llm_query_result', id: msg.id, result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleLlmQuery] Error: ${errorMsg}`);
    // Dual-emit: the generic `error` channel drives main-process OAuth
    // auth-refresh detection (centralized in PiAgent), while the targeted
    // `llm_query_result` rejects the pending promise for this specific call.
    send({ type: 'error', message: errorMsg, code: 'llm_query_error' });
    send({ type: 'llm_query_result', id: msg.id, result: null, errorMessage: errorMsg, errorCode: 'llm_query_error' });
  }
}

async function handleEnsureSessionReady(msg: Extract<InboundMessage, { type: 'ensure_session_ready' }>): Promise<void> {
  const session = await ensureSession();
  send({
    type: 'ensure_session_ready_result',
    id: msg.id,
    sessionId: session.sessionId || null,
  });
}

async function handleCompact(msg: Extract<InboundMessage, { type: 'compact' }>): Promise<void> {
  try {
    const session = await ensureSession();
    // Serialize manual /compact behind any in-flight auto-compaction. Public
    // session.compact() calls agent.abort() and uses its own controller; if
    // it runs while _runAutoCompaction is suspended, agent state churns and
    // the SDK's race surface widens. Wait for the auto-compaction to drain
    // before starting a manual one. waitForCompaction has its own timeout
    // fallback so we don't deadlock on a stuck subprocess.
    await waitForCompaction(session);
    const result = await session.compact(msg.customInstructions);
    send({
      type: 'compact_result',
      id: msg.id,
      success: true,
      result: {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[compact] Failed: ${errorMsg}`);
    send({
      type: 'compact_result',
      id: msg.id,
      success: false,
      errorMessage: errorMsg,
    });
  }
}

async function handleSetAutoCompaction(msg: Extract<InboundMessage, { type: 'set_auto_compaction' }>): Promise<void> {
  try {
    const session = await ensureSession();
    session.setAutoCompactionEnabled(msg.enabled);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: true,
      enabled: session.autoCompactionEnabled,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_auto_compaction] Failed: ${errorMsg}`);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: false,
      enabled: msg.enabled,
      errorMessage: errorMsg,
    });
  }
}

async function handleUpdateRuntimeConfig(msg: RuntimeConfigUpdateMessage): Promise<void> {
  try {
    if (!initConfig) {
      throw new Error('Runtime config update received before init');
    }

    runtimeConfigGeneration += 1;
    if (!piModelRegistry) moduleRuntimePromise = null;
    initConfig = {
      ...initConfig,
      model: msg.model,
      providerType: msg.providerType ?? initConfig.providerType,
      authType: msg.authType ?? initConfig.authType,
      baseUrl: msg.baseUrl,
      customEndpoint: msg.customEndpoint,
      customModels: msg.customModels,
    };

    if (piModelRegistry) {
      customEndpointModelIds = new Set();
      customModelOverrides.clear();
      if (initConfig.baseUrl?.trim() && initConfig.customEndpoint) {
        const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
          ? initConfig.customModels
          : [initConfig.model || 'default']
        ).map(normalizeCustomEndpointModelEntry);
        registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl.trim(), modelEntries);
      } else {
        // Runtime updates can move away from a custom endpoint. Leaving the old
        // synthetic provider registered lets later model resolution route back
        // to stale URL/capability data.
        piModelRegistry.unregisterProvider('custom-endpoint');
      }
    }

    if (piSession && piModelRegistry) {
      let piModel = resolveSessionPiModel(piModelRegistry, msg.model);
      if (!piModel && initConfig.baseUrl?.trim() && initConfig.customEndpoint) {
        const entry = findCustomEndpointModelEntry(msg.model, initConfig.customModels);
        registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl.trim(), [entry]);
        piModel = piModelRegistry.find('custom-endpoint', entry.id) ?? undefined;
        debugLog(`[runtime_config] Dynamically registered custom endpoint model: ${entry.id}`);
      }

      if (!piModel) {
        throw new Error(`Could not resolve model after runtime update: ${msg.model}`);
      }

      await piSession.setModel(piModel);
      applySwarmCompactionOverride(piModel);
      setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
      debugLog(`[runtime_config] Updated runtime config and active model: ${piModel.provider}/${piModel.id}`);
    } else {
      debugLog('[runtime_config] Stored update; no active session/model registry yet');
    }

    send({ type: 'update_runtime_config_result', id: msg.id, success: true, updated: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[runtime_config] Failed: ${errorMsg}`);
    send({ type: 'update_runtime_config_result', id: msg.id, success: false, updated: false, errorMessage: errorMsg });
  }
}

async function handleSetModel(msg: Extract<InboundMessage, { type: 'set_model' }>): Promise<void> {
  debugLog(`[set_model] Received: ${msg.model}`);
  if (!piSession || !piModelRegistry) {
    debugLog(`[set_model] No active session or model registry, ignoring`);
    return;
  }
  let piModel = resolveSessionPiModel(piModelRegistry, msg.model);

  // For custom endpoints, dynamically register unknown models so mid-session switching works.
  // Uses registerCustomEndpointModels which accumulates into the existing model set
  // (registerProvider replaces, so we track all IDs and re-register the full set).
  if (!piModel && initConfig?.baseUrl?.trim() && initConfig?.customEndpoint) {
    const entry = findCustomEndpointModelEntry(msg.model, initConfig.customModels);
    registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl!.trim(), [entry]);
    piModel = piModelRegistry.find('custom-endpoint', entry.id) ?? undefined;
    debugLog(`[set_model] Dynamically registered custom endpoint model: ${entry.id}`);
  }

  if (!piModel) {
    debugLog(`[set_model] Could not resolve model: ${msg.model}`);
    setInterceptorApiHints(undefined);
    return;
  }
  try {
    await piSession.setModel(piModel);
    applySwarmCompactionOverride(piModel);
    setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
    if (initConfig) initConfig.model = msg.model;
    debugLog(`[set_model] Model changed to: ${msg.model} (resolved: ${piModel.provider}/${piModel.id})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_model] Failed to set model: ${errorMsg}`);
  }
}

async function handleSetThinkingLevel(msg: Extract<InboundMessage, { type: 'set_thinking_level' }>): Promise<void> {
  debugLog(`[set_thinking_level] Received: ${msg.level}`);

  if (!piSession) {
    debugLog('[set_thinking_level] No active session, ignoring');
    return;
  }

  const piLevel = THINKING_TO_PI[msg.level as keyof typeof THINKING_TO_PI];
  if (!piLevel) {
    debugLog(`[set_thinking_level] No Pi mapping for level: ${msg.level}`);
    return;
  }

  try {
    piSession.setThinkingLevel(piLevel);
    debugLog(`[set_thinking_level] Thinking level changed to: ${msg.level} (mapped: ${piLevel})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_thinking_level] Failed to set thinking level: ${errorMsg}`);
  }
}

function handleShutdown(): void {
  debugLog('Shutdown requested');
  pendingSpawnFanOutQualifications.clear();
  activeSpawnTools = [];

  // Unsubscribe events
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }

  // Dispose session
  if (piSession) {
    piSession.dispose();
    piSession = null;
  }

  // Stop callback server
  stopCallbackServer();

  // Reject pending promises
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Server shutting down' });
  }
  pendingPreToolUse.clear();

  for (const [, pending] of pendingToolExecutions) {
    pending.resolve({ content: 'Server shutting down', isError: true });
  }
  pendingToolExecutions.clear();

  process.exit(0);
}

// ============================================================
// Main JSONL Reader Loop
// ============================================================

async function processMessage(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;

    case 'prompt':
      await handlePrompt(msg);
      break;

    case 'register_tools':
      handleRegisterTools(msg);
      break;

    case 'tool_execute_response':
      handleToolExecuteResponse(msg);
      break;

    case 'pre_tool_use_response':
      handlePreToolUseResponse(msg);
      break;

    case 'abort':
      await handleAbort();
      break;

    case 'mini_completion':
      await handleMiniCompletion(msg);
      break;

    case 'llm_query':
      await handleLlmQuery(msg);
      break;

    case 'ensure_session_ready':
      await handleEnsureSessionReady(msg);
      break;

    case 'set_model':
      await handleSetModel(msg);
      break;

    case 'set_thinking_level':
      await handleSetThinkingLevel(msg);
      break;

    case 'compact':
      await handleCompact(msg);
      break;

    case 'set_auto_compaction':
      await handleSetAutoCompaction(msg);
      break;

    case 'update_runtime_config':
      await handleUpdateRuntimeConfig(msg);
      break;

    case 'steer':
      if (piSession) {
        debugLog(`Steering with: "${msg.message.slice(0, 100)}"`);
        await piSession.steer(msg.message);
      } else {
        debugLog('Steer ignored — no active session');
      }
      break;

    case 'token_update':
      if (!initConfig) {
        debugLog('token_update received before init; ignoring');
        break;
      }
      initConfig.piAuth = msg.piAuth;
      if (moduleCredentialStore) {
        const { provider, credential } = msg.piAuth;
        await syncCredentialForPiSdk(moduleCredentialStore, provider, credential);
        debugLog(`Updated ${credential.type} credential for provider: ${provider}`);
      } else {
        // createAuthenticatedRuntime reads initConfig, so retaining the update is
        // sufficient when the first runtime has not been created yet.
        debugLog('Stored token_update for pending runtime initialization');
      }
      break;

    case 'shutdown':
      handleShutdown();
      break;

    default:
      debugLog(`Unknown message type: ${(msg as any).type}`);
  }
}

function main(): void {
  debugLog('Pi agent server starting');

  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as InboundMessage;
      processMessage(msg).catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debugLog(`Error processing message: ${errorMsg}`);
        send({ type: 'error', message: errorMsg });
      });
    } catch (parseError) {
      debugLog(`Failed to parse JSONL: ${parseError}`);
    }
  });

  rl.on('close', () => {
    debugLog('stdin closed, shutting down');
    handleShutdown();
  });

  // Handle unexpected errors — process state is unreliable after these,
  // so we attempt to report and then exit immediately.
  // send() is wrapped in try/catch because stdout itself may be broken
  // (e.g. EFAULT from a closed pipe), and we must not let the error
  // report trigger another uncaughtException (which would loop).
  process.on('uncaughtException', (error) => {
    debugLog(`Uncaught exception: ${error.message}`);
    try {
      send({ type: 'error', message: `Uncaught exception: ${error.message}`, code: 'uncaught' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    debugLog(`Unhandled rejection: ${msg}`);
    try {
      send({ type: 'error', message: `Unhandled rejection: ${msg}`, code: 'unhandled_rejection' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });
}

main();
