/**
 * Pi Backend (Subprocess RPC Client)
 *
 * Thin subprocess client for the Pi coding agent. Spawns a pi-agent-server
 * subprocess and communicates via JSONL over stdin/stdout.
 *
 * The subprocess runs the Pi SDK (@earendil-works/pi-coding-agent) in-process,
 * handles tool wrapping, permission enforcement, and LLM queries.
 * This file manages subprocess lifecycle, JSONL protocol, event forwarding,
 * and proxy tool routing for MCP/API sources.
 *
 * Auth is API key based. Keys are retrieved from the credential manager
 * and passed to the subprocess during initialization.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import { hydrateAttachmentBytes, imageAttachmentsMissingBytes } from '../utils/files.ts';
import { getProxyEnvVars } from '../config/proxy-env.ts';

import type {
  BackendConfig,
  BackendRuntimeUpdate,
  ChatOptions,
  SdkMcpServerConfig,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import { getBackendRuntime } from './backend/internal/driver-types.ts';
import { SourceActivationDrainController } from './source-activation-drain.ts';

import type { PermissionMode } from './mode-manager.ts';
import type { ThinkingLevel } from './thinking-levels.ts';

// Import models from centralized registry
import { getModelById } from '../config/models.ts';
import {
  connectionModelIdsMatch,
  inferModelSupportsImages,
  resolveCustomModelContextWindow,
} from '../config/model-image-support.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';

// BaseAgent provides common functionality
import { BaseAgent } from './base-agent.ts';
import type { Workspace } from '../config/storage.ts';

// Event adapter
import { PiEventAdapter } from './backend/pi/event-adapter.ts';
import { EventQueue } from './backend/event-queue.ts';

// System prompt for Selection context
import { getSystemPrompt } from '../prompts/system.ts';
import { getCoAuthorPreference } from '../config/preferences.ts';
import { loadProjectPromptContext } from '../projects/storage.ts';
import type { ProjectPromptContext } from '../projects/types.ts';
import { isSharedProjectMemoryEnabled } from '../sessions/types.ts';

// Credential manager for token storage
import { getCredentialManager } from '../credentials/manager.ts';

// ChatGPT OAuth token refresh (used when Pi routes ChatGPT auth)
import { refreshChatGptTokens } from '../auth/chatgpt-oauth.ts';

// Session-scoped tool callbacks (for SubmitPlan, source auth, etc.)
import {
  registerSessionScopedToolCallbacks,
  mergeSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  setLastPlanFilePath,
  getSessionScopedToolCallbacks,
} from './session-scoped-tools.ts';
import { attachSessionSelfManagementBindings } from './session-self-management-bindings.ts';

// Session tool proxy definitions (for registering with subprocess)
import {
  getSessionToolProxyDefs,
  SESSION_TOOL_NAMES,
} from './backend/pi/session-tool-defs.ts';

// Session tool registry (for executing proxy tool calls)
import {
  SESSION_BACKEND_TOOL_NAMES,
  SESSION_TOOL_REGISTRY,
  type ToolContent as SessionToolContent,
  type ToolResult as SessionToolResult,
} from '@craft-agent/session-tools-core';
import { createClaudeContext, type SessionToolContext } from './claude-context.ts';
import { getPermissionModeDiagnostics } from './mode-manager.ts';

// call_llm pre-execution pipeline

// McpClientPool for source tool proxying (centralized pool from main process)
import type { McpClientPool } from '../mcp/mcp-pool.ts';

// Path utilities
import { delimiter, join } from 'node:path';
import { homedir } from 'os';
import {
  getOfficecliWrapperDir,
  isOfficecliShellCommand,
  resolveOfficecliBinary,
  resolveOfficecliResourcesRoot,
} from '../utils/officecli.ts';

// Session storage (plans folder path)
import { getSessionDataPath, getSessionPath, getSessionPlansPath } from '../sessions/storage.ts';

// Error typing
import { parseError, type AgentError } from './errors.ts';

// Centralized PreToolUse pipeline
import { runPreToolUseChecks, type PreToolUseCheckResult } from './core/pre-tool-use.ts';
import { recoverKnownToolInputFromIntent } from './core/tool-input-recovery.ts';
import { getBrowserToolEnabled } from '../config/storage.ts';

// Workspace slug extraction for skill qualification
import { extractWorkspaceSlug } from '../utils/workspace.ts';

// LLM tool types
import { LLM_QUERY_TIMEOUT_MS, type LLMQueryRequest, type LLMQueryResult } from './llm-tool.ts';
import { executeBrowserToolCommand } from './browser-tool-runtime.ts';
import { saveBinaryResponse } from '../utils/binary-detection.ts';

// ============================================================
// PiAgent Implementation
// ============================================================

/** Backend-executed session tools currently supported by PiAgent. */
export const PI_BACKEND_SESSION_TOOL_NAMES = new Set<string>([
  'call_llm',
  'spawn_session',
  'browser_tool',
]);

type ProxyToolExecutionResult = {
  content: string | SessionToolContent[];
  isError: boolean;
};

/**
 * Map a transport `err.code` to an agent-facing string for `browser_tool` failures.
 * Returns null for unknown codes so callers can fall back to the raw `err.message`.
 *
 * Receiver-side check: keyed on `err.code === 'X'`, never `instanceof CodedError` —
 * the transport reconstructs a plain `Error` with `.code` attached.
 */
function mapBrowserToolErrorCode(code: string): string | null {
  switch (code) {
    case 'BROWSER_NO_CAPABLE_CLIENT':
    case 'CAPABILITY_UNAVAILABLE':
      return 'No connected desktop client supports browser tools, or no client is currently connected. ' +
        'Ask the user to open this workspace from the Selection desktop app.';
    case 'CLIENT_DISCONNECTED':
      return 'The desktop client that owned this browser session disconnected. ' +
        'Ask the user to reconnect and retry.';
    case 'CLIENT_REQUEST_TIMEOUT':
      return 'Browser operation timed out (>30s). The desktop client may be unresponsive.';
    case 'BROWSER_INSTANCE_NOT_OWNED':
      return 'That browser instance ID doesn\'t belong to this session. ' +
        'Use `windows` to list owned instances, or `open` to create a new one.';
    case 'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED':
      return 'File upload from a remote agent is not supported. ' +
        'Ask the user to attach the file to the session.';
    case 'BROWSER_REMOTE_EVALUATE_BLOCKED':
      return 'JavaScript evaluation is disabled on this desktop client. ' +
        'Ask the user to enable it in settings.';
    default:
      return null;
  }
}

/**
 * Backend implementation using the Pi coding agent SDK via subprocess.
 *
 * Spawns a pi-agent-server subprocess and communicates via JSONL protocol.
 * Extends BaseAgent for common functionality (permission mode, source management,
 * planning heuristics, config watching, usage tracking).
 */
export class PiAgent extends BaseAgent {
  protected backendName = 'Selection Backend';

  // ============================================================
  // Subprocess State
  // ============================================================

  // Subprocess process handle
  private subprocess: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private subprocessReady: Promise<void> | null = null;
  private subprocessReadyResolve: (() => void) | null = null;

  // Pi session ID (managed by subprocess, reported back)
  private piSessionId: string | null = null;

  // Callback server port (managed by subprocess)
  private callbackPort: number = 0;

  // State
  private _isProcessing: boolean = false;
  private abortReason?: AbortReason;

  // Event adapter
  private adapter: PiEventAdapter;

  // Event queue for streaming (AsyncGenerator pattern over subprocess JSONL)
  private eventQueue = new EventQueue();

  // Error deduplication — suppress identical consecutive errors after a threshold
  // to prevent a broken subprocess from flooding the user's session.
  private lastSubprocessError: string | null = null;
  private subprocessErrorRepeatCount = 0;
  private static readonly MAX_IDENTICAL_SUBPROCESS_ERRORS = 3;
  // Captured once per PiAgent instance so active sessions do not dynamically
  // absorb MEMORY.md edits made by other sessions between turns.
  private pinnedProjectContext: ProjectPromptContext | null | undefined;

  /**
   * Look up the bound project (if any) and return a snapshot for system-prompt injection.
   * Mirrors ClaudeAgent.resolveProjectContext.
   */
  private resolveProjectContext(): ProjectPromptContext | null {
    const projectId = this.config.session?.projectId;
    if (!projectId) return null;

    try {
      const root = this.config.workspace.rootPath;
      const includeMemory = isSharedProjectMemoryEnabled(this.config.session);
      return loadProjectPromptContext(root, projectId, includeMemory);
    } catch (error) {
      this.debug(`[resolveProjectContext] Failed to load project ${projectId}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private getPinnedProjectContext(): ProjectPromptContext | null {
    if (this.pinnedProjectContext === undefined) {
      this.pinnedProjectContext = this.resolveProjectContext();
    }
    return this.pinnedProjectContext;
  }

  private resetSubprocessErrorDedup(): void {
    this.lastSubprocessError = null;
    this.subprocessErrorRepeatCount = 0;
  }

  // Ring buffer of recent subprocess stderr. Always on (independent of CRAFT_DEBUG)
  // so that connection-test and other failures can surface what the subprocess
  // actually said, instead of a bare "timed out" with no context.
  private stderrBuffer: string[] = [];
  private stderrBufferBytes = 0;
  private static readonly STDERR_BUFFER_MAX_BYTES = 8 * 1024;

  private recordStderr(chunk: string): void {
    if (!chunk) return;
    // If a single chunk is larger than the cap, keep only its tail so the
    // buffer always holds the most-recent output even in pathological cases.
    const effective = chunk.length > PiAgent.STDERR_BUFFER_MAX_BYTES
      ? chunk.slice(chunk.length - PiAgent.STDERR_BUFFER_MAX_BYTES)
      : chunk;
    this.stderrBuffer.push(effective);
    this.stderrBufferBytes += effective.length;
    // Drop oldest chunks until we're back under the cap, but always keep at
    // least one entry so a single-chunk tail survives.
    while (this.stderrBufferBytes > PiAgent.STDERR_BUFFER_MAX_BYTES && this.stderrBuffer.length > 1) {
      const dropped = this.stderrBuffer.shift()!;
      this.stderrBufferBytes -= dropped.length;
    }
  }

  /** Returns the most recent subprocess stderr output (up to ~8KB). Empty string if nothing captured. */
  getRecentStderr(): string {
    return this.stderrBuffer.join('');
  }

  // Pending permission requests (used by handlePreToolUseRequest for ask-mode prompting)
  private pendingPermissions: Map<string, {
    resolve: (allowed: boolean) => void;
    toolName: string;
  }> = new Map();

  // Pending tool executions (correlation map for subprocess tool_execute_request -> main process -> tool_execute_response)
  private pendingToolExecutions: Map<string, {
    resolve: (result: ProxyToolExecutionResult) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Pending mini completions (correlation map for subprocess mini_completion_result)
  private pendingMiniCompletions: Map<string, {
    resolve: (text: string | null) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Pending llm_query calls (correlation map for subprocess llm_query_result).
  // Separate from pendingMiniCompletions because the payload shape differs:
  // queryLlm returns a full LLMQueryResult, not just text.
  private pendingLlmQueries: Map<string, {
    resolve: (result: LLMQueryResult) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Pending ensure_session_ready requests (branch preflight handshake)
  private pendingEnsureSessionReady: Map<string, {
    resolve: (sessionId: string | null) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Pending compact requests (manual compaction RPC)
  private pendingCompactions: Map<string, {
    resolve: (result: { summary: string; firstKeptEntryId: string; tokensBefore: number } | null) => void;
    reject: (error: Error) => void;
  }> = new Map();

  private setupEmitted = false;
  private sessionStartEmitted = false;
  private sessionEndEmitted = false;
  private stopEmitted = false;
  private preCompactEmitted = false;

  // Pending auto-compaction toggle requests
  private pendingAutoCompactionToggles: Map<string, {
    resolve: (enabled: boolean) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Pending runtime config updates (custom endpoint model capability refresh)
  private pendingRuntimeConfigUpdates: Map<string, {
    resolve: (updated: boolean) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Metadata captured before PreToolUse stripping, keyed by toolCallId.
  // This provides a deterministic bridge when side-channel metadata store misses.
  private preToolMetadataByCallId: Map<string, {
    intent?: string;
    displayName?: string;
    capturedAt: number;
  }> = new Map();

  // Current user message (for context in summarization)
  private currentUserMessage: string = '';

  private managedOfficecliShellAvailable = false;
  private managedOfficecliBinaryPath?: string;

  // Pool reference for convenience (from this.config.mcpPool)
  private get mcpPool(): McpClientPool | undefined { return this.config.mcpPool; }

  // Cached session tool context (lazy-created on first session tool call)
  private _sessionToolContext: SessionToolContext | null = null;

  // RPC request counter for unique IDs
  private rpcIdCounter: number = 0;

  // OAuth token refresh (ChatGPT Plus)
  /**
   * @deprecated Use onBackendAuthRequired (inherited from BaseAgent) instead.
   * Kept as a getter/setter alias for backward compatibility.
   */
  get onChatGptAuthRequired(): ((reason: string) => void) | null {
    return this.onBackendAuthRequired;
  }
  set onChatGptAuthRequired(cb: ((reason: string) => void) | null) {
    this.onBackendAuthRequired = cb;
  }
  private tokenRefreshInProgress: Promise<void> | null = null;

  // Global mutex: keyed by connectionSlug so multiple PiAgent instances
  // sharing the same connection don't race concurrent token refreshes.
  private static globalRefreshMutex: Map<string, Promise<void>> = new Map();

  // ============================================================
  // Constructor
  // ============================================================

  constructor(config: BackendConfig) {
    const resolvedModel = config.model || '';
    const contextWindow = resolveCustomModelContextWindow(
      getBackendRuntime(config).customModels,
      resolvedModel,
    ) ?? getModelById(resolvedModel)?.contextWindow;
    super(config, resolvedModel, contextWindow);

    this._supportsBranching = true;

    this.piSessionId = config.session?.sdkSessionId || null;
    this.adapter = new PiEventAdapter();
    if (contextWindow) {
      this.adapter.setContextWindow(contextWindow);
    }
    if (config.miniModel) {
      this.adapter.setMiniModel(config.miniModel);
    }

    // Set session dir on adapter for concurrent-safe toolMetadataStore lookups
    if (config.session?.id && config.workspace.rootPath) {
      this.adapter.setSessionDir(join(config.workspace.rootPath, 'sessions', config.session.id));
    }

    // Wire the adapter's async overflow fallback into the event queue. The
    // fallback fires when the SDK doesn't emit a compaction_start after a
    // held overflow agent_end (e.g. _overflowRecoveryAttempted was already
    // true). It runs outside adaptEvent() so it can't yield through the
    // generator — instead, it calls these callbacks to enqueue the buffered
    // error and terminate the iterator.
    this.adapter.setOverflowFallbackHandlers(
      (event) => this.eventQueue.enqueue(event),
      () => this.eventQueue.complete(),
    );

    if (!config.isHeadless) {
      this.startConfigWatcher();
    }
  }

  /**
   * Guardrail: ensure every backend-mode session tool from core is implemented here.
   * This fails fast in development/CI instead of surfacing as runtime "Unknown session tool".
   */
  private assertBackendSessionToolParity(): void {
    const missing = [...SESSION_BACKEND_TOOL_NAMES].filter(
      (name) => !PI_BACKEND_SESSION_TOOL_NAMES.has(name),
    );

    if (missing.length > 0) {
      throw new Error(
        `PiAgent missing backend session tool implementations: ${missing.join(', ')}`,
      );
    }
  }

  // ============================================================
  // Subprocess Management
  // ============================================================

  /**
   * Ensure the subprocess is spawned and ready.
   * Lazy initialization -- spawns on first use.
   */
  private async ensureSubprocess(): Promise<void> {
    if (this.subprocess && this.subprocessReady) {
      await this.subprocessReady;
      return;
    }

    await this.spawnSubprocess();
  }

  /**
   * Spawn the pi-agent-server subprocess and set up JSONL communication.
   */
  private async spawnSubprocess(): Promise<void> {
    const runtime = getBackendRuntime(this.config);
    const piServerPath = runtime.paths?.piServer;
    if (!piServerPath) {
      throw new Error('piServerPath not configured. Cannot spawn Pi subprocess.');
    }

    const nodePath = runtime.paths?.node;
    if (!nodePath) {
      throw new Error(
        'Bun/Node runtime not configured. Refusing to launch the Pi server with Electron.',
      );
    }
    const cwd = this.resolvedCwd();

    this.debug(`Spawning Pi subprocess: ${nodePath} ${piServerPath}`);
    this.resetSubprocessErrorDedup();

    // Set up ready promise before spawning
    this.subprocessReady = new Promise<void>((resolve) => {
      this.subprocessReadyResolve = resolve;
    });

    // Build session ID and session dir path upfront (used for spawn env + init command)
    const sessionId = this.config.session?.id || `agent-${Date.now()}`;
    const sessionDir = this.config.session
      ? join(this.config.workspace.rootPath, 'sessions', sessionId)
      : undefined;

    // Build spawn args — optionally preload the network interceptor
    // for tool metadata injection/capture across all API formats.
    const args = [piServerPath];
    const interceptorPath = runtime.paths?.interceptor;
    if (interceptorPath) {
      args.unshift('--require', interceptorPath);
    }

    // Resolve credentials before spawning so we can derive AWS env vars
    // from the same fetch that produces piAuth (single source of truth).

    // For Copilot OAuth: preemptively refresh the short-lived Copilot token
    // before fetching credentials, so getPiAuth() picks up a fresh token.
    // refreshAndPushTokens guards this.subprocess internally — safe to call pre-spawn.
    if (this.config.authType === 'oauth' && runtime.piAuthProvider === 'github-copilot') {
      const slug = this.config.connectionSlug || 'pi';
      const stored = await getCredentialManager().getLlmOAuth(slug);
      if (stored?.refreshToken && (!stored.expiresAt || stored.expiresAt < Date.now() + 5 * 60_000)) {
        this.debug('Copilot token expired or expiring soon — refreshing before session start');
        await this.refreshAndPushTokens();
      }
    }

    // Retrieve auth credentials for the subprocess.
    // Custom endpoint mode must NOT fall back to global API keys — keyless local endpoints
    // are valid, and non-local endpoints should fail explicitly instead of using unrelated creds.
    const piAuth = await this.getPiAuth();
    const isCustomEndpointMode = !!runtime.customEndpoint;
    const legacyApiKey = (!piAuth && !isCustomEndpointMode) ? await this.getApiKey() : undefined;
    if (isCustomEndpointMode && !piAuth) {
      this.debug('Custom endpoint mode: no provider credential configured, sending empty API key');
    }

    // Derive AWS env vars from the piAuth credential (single fetch, no race).
    const awsEnv = this.buildAwsEnv(piAuth, runtime);
    const officecliResolution = {
      cwd: runtime.officecliHost?.appRootPath ?? process.cwd(),
      appRootPath: runtime.officecliHost?.appRootPath,
      resourcesPath: runtime.officecliHost?.resourcesPath,
      // Session/connection environment overrides must not replace Selection's
      // reviewed OfficeCLI toolchain. These roots come from the app shell.
      trustEnvironment: false,
    };
    const officecliWrapperDir = getOfficecliWrapperDir(officecliResolution);
    const officecliBinary = resolveOfficecliBinary(officecliResolution);
    const officecliResources = resolveOfficecliResourcesRoot(officecliResolution);
    this.managedOfficecliShellAvailable = Boolean(officecliWrapperDir && officecliBinary && officecliResources);
    this.managedOfficecliBinaryPath = this.managedOfficecliShellAvailable ? officecliBinary : undefined;
    const officecliShellWrapper = this.managedOfficecliShellAvailable && officecliWrapperDir
      ? join(officecliWrapperDir, process.platform === 'win32' ? 'officecli.cmd' : 'officecli')
      : undefined;
    const inheritedPath = this.config.envOverrides?.PATH ?? process.env.PATH ?? '';
    const managedToolPath = officecliWrapperDir
      ? `${officecliWrapperDir}${inheritedPath ? `${delimiter}${inheritedPath}` : ''}`
      : inheritedPath;

    // Spawn the subprocess
    const child = spawn(nodePath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...getProxyEnvVars(),
        ...this.config.envOverrides,
        ...awsEnv,
        // Resolve Selection's wrapper before any user-installed OfficeCLI.
        ...(managedToolPath ? { PATH: managedToolPath } : {}),
        // Expose the trusted wrapper, which adds the sole Word compatibility repair.
        CRAFT_OFFICECLI: officecliShellWrapper ?? '',
        // Never inherit a session/user resource override. Official guides and
        // helper assets must come from the same trusted Selection package.
        CRAFT_OFFICECLI_RESOURCES: officecliResources ?? '',
        CRAFT_BUN: nodePath,
        // Pass session dir for cross-process toolMetadataStore
        ...(sessionDir ? { CRAFT_SESSION_DIR: sessionDir } : {}),
        // Propagate debug mode
        CRAFT_DEBUG: (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1') ? '1' : '0',
      },
    });

    this.subprocess = child;

    // Set up readline for JSONL parsing from stdout
    this.readline = createInterface({
      input: child.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      this.handleLine(line);
    });

    // Always capture stderr into a bounded ring buffer so callers (e.g. the
    // connection-test timeout path in factory.ts) can surface it on failure.
    // Keep the CRAFT_DEBUG-gated log for interactive dev work.
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.recordStderr(text);
      const trimmed = text.trim();
      if (trimmed) {
        this.debug(`[subprocess stderr] ${trimmed}`);
      }
    });

    // Handle subprocess exit
    child.on('exit', (code, signal) => {
      this.handleSubprocessExit(code, signal);
    });

    child.on('error', (error) => {
      this.debug(`Subprocess error: ${error.message}`);
      this.resetSubprocessErrorDedup();
      this.eventQueue.enqueue({ type: 'error', message: `Pi subprocess error: ${error.message}` });
      this.eventQueue.complete();
    });

    const sessionPath = this.config.session
      ? getSessionPath(this.config.workspace.rootPath, sessionId)
      : '';
    const plansFolderPath = getSessionPlansPath(this.config.workspace.rootPath, sessionId);
    const workingDirectory = this.config.session?.workingDirectory || cwd;

    // Send init command (flat structure matching subprocess InboundMessage type)
    this.send({
      type: 'init',
      apiKey: legacyApiKey || '',
      model: this._model,
      cwd,
      thinkingLevel: this._thinkingLevel,
      workspaceRootPath: this.config.workspace.rootPath,
      sessionId,
      sessionPath,
      workingDirectory,
      plansFolderPath,
      miniModel: this.config.miniModel,
      providerType: this.config.providerType,
      authType: this.config.authType,
      workspaceId: this.config.workspace.id,
      piAuth,
      baseUrl: runtime.baseUrl,
      customEndpoint: runtime.customEndpoint,
      customModels: runtime.customModels,
      // Branch params for Pi SDK session fork
      branchFromSdkSessionId: this.config.session?.branchFromSdkSessionId,
      branchFromSessionPath: this.config.session?.branchFromSessionPath,
      branchFromSdkTurnId: this.config.session?.branchFromSdkTurnId,
      resumeSdkSessionId: this.config.session?.sdkSessionId,
      forceFreshSession: this.config.session?.forceFreshSdkSession,
    });

    // Wait for subprocess to report ready
    await this.subprocessReady;
    this.debug('Pi subprocess is ready');

    // Ensure auto-compaction is explicitly enabled for embedded sessions.
    // PI defaults this to enabled, but we set it proactively for clarity and resilience.
    try {
      const enabled = await this.requestSetAutoCompaction(true);
      this.debug(`PI auto-compaction enabled: ${enabled}`);
    } catch (error) {
      this.debug(`Failed to configure PI auto-compaction (continuing): ${error instanceof Error ? error.message : String(error)}`);
    }

    // Register session-scoped tools as proxy tools in the subprocess.
    // These tools (SubmitPlan, config_validate, source auth, call_llm, etc.)
    // are executed in the main process when the LLM calls them.
    this.assertBackendSessionToolParity();
    let sessionToolDefs = getSessionToolProxyDefs();

    // Mirror Claude's gate: hide `browser_tool` when the user has disabled
    // the built-in browser tool. Without this filter, Pi would still advertise
    // `mcp__session__browser_tool` while Claude doesn't — sessions would behave
    // inconsistently depending on backend.
    if (!getBrowserToolEnabled()) {
      sessionToolDefs = sessionToolDefs.filter(d => d.name !== 'mcp__session__browser_tool');
    }

    // Patch call_llm description with provider-specific model hint
    if (this.config.miniModel) {
      const callLlmDef = sessionToolDefs.find(d => d.name === 'mcp__session__call_llm');
      if (callLlmDef) {
        callLlmDef.description += `\n\nDefault fast model for this session: ${this.config.miniModel}. Omit the model parameter to use it automatically.`;
      }
    }

    this.send({
      type: 'register_tools',
      tools: sessionToolDefs,
    });
    this.debug(`Registered ${sessionToolDefs.length} session tools with subprocess`);

    // If pool has source tools, register them with the subprocess.
    this.registerPoolToolsWithSubprocess();
    this.emitLifecycleReadyOnce();
  }

  /**
   * Send pool's proxy tool defs to subprocess for model visibility.
   */
  private registerPoolToolsWithSubprocess(): void {
    if (!this.mcpPool) return;
    const proxyDefs = this.mcpPool.getProxyToolDefs();
    if (proxyDefs.length > 0) {
      this.send({
        type: 'register_tools',
        tools: proxyDefs,
      });
      this.debug(`Registered ${proxyDefs.length} MCP source tools from pool with subprocess`);
    }
  }

  /**
   * Build structured Pi auth from connection config.
   * Returns a provider-aware credential object for the subprocess,
   * or null if no piAuthProvider is configured (falls back to legacy getApiKey).
   *
   * OAuth tokens from Craft (Claude Max, ChatGPT Plus, Copilot) are passed as
   * api_key type because they function as bearer tokens that the Pi SDK's provider
   * modules use directly. The OAuth exchange happens on the Craft side; by the time
   * it reaches Pi, it's just an access token.
   */
  private async getPiAuth(): Promise<{
    provider: string;
    credential:
      | { type: 'api_key'; key: string }
      | { type: 'oauth'; access: string; refresh: string; expires: number }
      | { type: 'iam'; accessKeyId: string; secretAccessKey: string; region?: string; sessionToken?: string }
  } | null> {
    const piAuthProvider = getBackendRuntime(this.config).piAuthProvider;
    if (!piAuthProvider) return null;

    try {
      const credentialManager = getCredentialManager();
      const slug = this.config.connectionSlug || 'pi';

      if (this.config.authType === 'oauth') {
        const oauth = await credentialManager.getLlmOAuth(slug);
        if (oauth?.accessToken) {
          // Copilot: pass full OAuth credential so the Pi SDK can derive the
          // correct API endpoint from the Copilot token's proxy-ep field.
          // The refresh token is the GitHub access token used to obtain fresh
          // Copilot tokens when they expire (~1 hour).
          if (piAuthProvider === 'github-copilot' && oauth.refreshToken) {
            this.debug(`Retrieved Copilot OAuth credential for Pi provider: ${piAuthProvider}`);
            return {
              provider: piAuthProvider,
              credential: {
                type: 'oauth',
                access: oauth.accessToken,
                refresh: oauth.refreshToken,
                expires: oauth.expiresAt ?? 0,
              },
            };
          }
          // Other OAuth providers: pass as api_key (bearer token)
          this.debug(`Retrieved OAuth access token for Pi provider: ${piAuthProvider}`);
          return {
            provider: piAuthProvider,
            credential: { type: 'api_key', key: oauth.accessToken },
          };
        }
      } else if (this.config.authType === 'iam_credentials') {
        // AWS IAM credentials — pass structured fields so the subprocess can
        // identify the credential type. Actual AWS env var injection happens
        // at spawn time (see spawnSubprocess) for proper process isolation.
        const iam = await credentialManager.getLlmIamCredentials(slug);
        if (iam) {
          this.debug(`Retrieved IAM credentials for Pi provider: ${piAuthProvider}`);
          return {
            provider: piAuthProvider,
            credential: {
              type: 'iam',
              accessKeyId: iam.accessKeyId,
              secretAccessKey: iam.secretAccessKey,
              region: iam.region,
              sessionToken: iam.sessionToken,
            },
          };
        }
      } else {
        // API key-based connections.
        // NOTE: authType === 'environment' (e.g. Bedrock with ~/.aws/credentials)
        // intentionally falls through here, finds no API key, and returns null.
        // The subprocess inherits process.env which contains the AWS credential chain.
        const apiKey = await credentialManager.getLlmApiKey(slug);
        if (apiKey) {
          this.debug(`Retrieved API key credential for Pi provider: ${piAuthProvider}`);
          return {
            provider: piAuthProvider,
            credential: { type: 'api_key', key: apiKey },
          };
        }
      }

      this.debug(`No credentials found for Pi provider: ${piAuthProvider}`);
      return null;
    } catch (error) {
      this.debug(`Failed to retrieve Pi auth: ${error}`);
      return null;
    }
  }

  /**
   * Build AWS environment variables from piAuth credentials for the subprocess.
   *
   * The Pi SDK's Bedrock provider reads from the AWS default credential chain
   * (env vars), not from Pi AuthStorage. We inject at spawn time so credentials
   * are scoped to the subprocess and don't leak to the main process.
   *
   * NOTE: IAM credentials (especially STS session tokens) are immutable after
   * spawn — they cannot be refreshed in a running subprocess. Long sessions
   * with temporary credentials (~1h STS tokens) will fail on expiry.
   */
  private buildAwsEnv(
    piAuth: Awaited<ReturnType<PiAgent['getPiAuth']>>,
    runtime: { piAuthProvider?: string },
  ): Record<string, string> {
    if (runtime.piAuthProvider !== 'amazon-bedrock') return {};

    const env: Record<string, string> = {};

    if (piAuth?.credential.type === 'iam') {
      env.AWS_ACCESS_KEY_ID = piAuth.credential.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = piAuth.credential.secretAccessKey;
      if (piAuth.credential.region) env.AWS_REGION = piAuth.credential.region;
      if (piAuth.credential.sessionToken) env.AWS_SESSION_TOKEN = piAuth.credential.sessionToken;
      this.debug('Injecting IAM credentials into subprocess env for AWS SDK');
    }

    // Defensive: force HTTP/1.1 for Bedrock. AWS SDK v3 defaults to HTTP/2
    // (NodeHttp2Handler) which can be incompatible with Bun/Electron runtimes.
    if (!process.env.AWS_BEDROCK_FORCE_HTTP1) {
      env.AWS_BEDROCK_FORCE_HTTP1 = '1';
    }

    return env;
  }

  /**
   * Refresh OAuth tokens and push updated credentials to the running subprocess.
   * Handles both Copilot (Pi SDK) and ChatGPT Plus token refresh.
   */
  private async refreshAndPushTokens(): Promise<void> {
    if (this.config.authType !== 'oauth') return;

    const slug = this.config.connectionSlug || 'pi';

    // Global mutex — if another PiAgent instance on the same connection slug
    // is already refreshing, just wait for that to finish and push the
    // (now-fresh) credentials to our subprocess.
    const existing = PiAgent.globalRefreshMutex.get(slug);
    if (existing) {
      this.debug(`Waiting on existing refresh for slug "${slug}"`);
      await existing;
      // The other instance refreshed the credential store — push to our subprocess
      if (this.subprocess) {
        const piAuth = await this.getPiAuth();
        if (piAuth) {
          this.send({ type: 'token_update', piAuth });
          this.debug('Pushed credentials refreshed by sibling instance');
        }
      }
      return;
    }

    const refreshPromise = (async () => {
      const piAuthProvider = getBackendRuntime(this.config).piAuthProvider;
      const credentialManager = getCredentialManager();
      const stored = await credentialManager.getLlmOAuth(slug);

      if (!stored?.refreshToken) {
        this.debug('No refresh token available — re-auth required');
        this.onBackendAuthRequired?.('No refresh token — please sign in again');
        return;
      }

      try {
        if (piAuthProvider === 'github-copilot') {
          // Copilot: refresh the short-lived Copilot token using the GitHub access token
          const { refreshGitHubCopilotToken } = await import('@earendil-works/pi-ai/oauth');
          const newCreds = await refreshGitHubCopilotToken(stored.refreshToken);
          await credentialManager.setLlmOAuth(slug, {
            accessToken: newCreds.access,
            refreshToken: newCreds.refresh,
            expiresAt: newCreds.expires,
          });
        } else {
          // ChatGPT Plus: use existing refresh utility
          const newTokens = await refreshChatGptTokens(stored.refreshToken);
          await credentialManager.setLlmOAuth(slug, {
            accessToken: newTokens.accessToken,
            idToken: newTokens.idToken,
            refreshToken: newTokens.refreshToken,
            expiresAt: newTokens.expiresAt,
          });
        }
        this.debug('Token refresh successful');

        // Push refreshed credentials to running subprocess
        if (this.subprocess) {
          const piAuth = await this.getPiAuth();
          if (piAuth) {
            this.send({ type: 'token_update', piAuth });
            this.debug('Pushed refreshed credentials to subprocess');
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.debug(`Token refresh failed: ${msg}`);
        this.onBackendAuthRequired?.(`Token refresh failed: ${msg}`);
      }
    })();

    // Store in both instance and global mutex
    this.tokenRefreshInProgress = refreshPromise;
    PiAgent.globalRefreshMutex.set(slug, refreshPromise);

    try {
      await refreshPromise;
    } finally {
      this.tokenRefreshInProgress = null;
      // Only clear global if it's still our promise (no newer refresh started)
      if (PiAgent.globalRefreshMutex.get(slug) === refreshPromise) {
        PiAgent.globalRefreshMutex.delete(slug);
      }
    }
  }

  /**
   * Retrieve API key from the credential manager for subprocess injection.
   * Legacy fallback when piAuthProvider is not set.
   * The subprocess expects a single API key string (passed via init.apiKey).
   */
  private async getApiKey(): Promise<string | null> {
    try {
      const credentialManager = getCredentialManager();
      const slug = this.config.connectionSlug || 'pi';

      // Try LLM OAuth first (for OAuth-based connections)
      const oauth = await credentialManager.getLlmOAuth(slug);
      if (oauth?.accessToken) {
        this.debug('Retrieved API key from LLM OAuth');
        return oauth.accessToken;
      }

      // Try Anthropic API key
      const apiKey = await credentialManager.getApiKey();
      if (apiKey) {
        this.debug('Retrieved Anthropic API key');
        return apiKey;
      }

      this.debug('No API keys found for Pi agent');
      return null;
    } catch (error) {
      this.debug(`Failed to retrieve API key: ${error}`);
      return null;
    }
  }

  /**
   * Send a JSONL command to the subprocess stdin.
   */
  private send(cmd: Record<string, unknown>): void {
    if (!this.subprocess?.stdin?.writable) {
      this.debug('Cannot send to subprocess: stdin not writable');
      return;
    }
    const line = JSON.stringify(cmd);
    this.subprocess.stdin.write(line + '\n');
  }

  /**
   * Parse a JSONL line from subprocess stdout and dispatch by type.
   */
  private handleLine(line: string): void {
    if (!line.trim()) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      this.debug(`Invalid JSONL from subprocess: ${line.slice(0, 200)}`);
      return;
    }

    const type = msg.type as string;

    if (type !== 'error') {
      this.resetSubprocessErrorDedup();
    }

    switch (type) {
      case 'ready':
        // Subprocess initialized, callback server listening
        this.callbackPort = (msg.callbackPort as number) || 0;
        if (msg.sessionId) {
          this.piSessionId = msg.sessionId as string;
          this.config.onSdkSessionIdUpdate?.(this.piSessionId!);
        }
        this.subprocessReadyResolve?.();
        break;

      case 'event':
        // Pi SDK event -- forward through PiEventAdapter
        this.handleSubprocessEvent(msg.event as Record<string, unknown>);
        break;

      case 'pre_tool_use_request':
        // Subprocess needs permission check + transforms before tool execution
        this.handlePreToolUseRequest(msg as {
          requestId: string;
          toolName: string;
          toolCallId?: string;
          input: Record<string, unknown>;
        });
        break;

      case 'tool_execute_request':
        // Subprocess wants main process to execute a proxy tool (MCP/API/session)
        this.handleToolExecuteRequest(msg as {
          requestId: string;
          toolName: string;
          args: Record<string, unknown>;
        });
        break;

      case 'session_tool_completed':
        // Session MCP tool completed -- fire callbacks (SubmitPlan, auth, etc.)
        this.handleSessionToolCompleted(msg);
        break;

      case 'mini_completion_result':
        // Response to a mini_completion request
        this.handleMiniCompletionResult(msg);
        break;

      case 'llm_query_result': {
        // Response to an llm_query request
        const id = msg.id as string;
        const pending = this.pendingLlmQueries.get(id);
        if (pending) {
          this.pendingLlmQueries.delete(id);
          const result = msg.result as LLMQueryResult | null;
          if (result) {
            pending.resolve(result);
          } else {
            const errorMessage = typeof msg.errorMessage === 'string' ? msg.errorMessage : 'llm_query failed';
            pending.reject(new Error(errorMessage));
          }
        }
        break;
      }

      case 'ensure_session_ready_result':
        // Response to an ensure_session_ready request
        this.handleEnsureSessionReadyResult(msg);
        break;

      case 'compact_result':
        // Response to a compact request
        this.handleCompactResult(msg);
        break;

      case 'set_auto_compaction_result':
        // Response to an auto-compaction toggle request
        this.handleSetAutoCompactionResult(msg);
        break;

      case 'update_runtime_config_result':
        // Response to a runtime config refresh request
        this.handleRuntimeConfigUpdateResult(msg);
        break;

      case 'session_id_update':
        // Pi session ID changed
        if (msg.sessionId) {
          this.piSessionId = msg.sessionId as string;
          this.config.onSdkSessionIdUpdate?.(this.piSessionId!);
        }
        break;

      case 'error': {
        const errorCode = typeof msg.code === 'string' ? msg.code : undefined;
        const rawMessage = String(msg.message || 'Unknown subprocess error');

        this.debug(`Subprocess error${errorCode ? ` (${errorCode})` : ''}: ${rawMessage}`);
        const errorMsg = rawMessage.toLowerCase();

        // Detect auth errors and attempt token refresh for OAuth connections
        if (this.config.authType === 'oauth' && (
          errorMsg.includes('401') ||
          errorMsg.includes('421') ||
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('misdirected') ||
          (errorMsg.includes('token') && errorMsg.includes('expired')) ||
          errorMsg.includes('authentication')
        )) {
          this.debug('Auth error detected from subprocess, attempting token refresh');
          this.refreshAndPushTokens().catch(err => {
            this.debug(`Token refresh after auth error failed: ${err}`);
          });
        }

        // Reject any pending mini completions so errors propagate immediately.
        // mini_completion_error is an internal utility-path failure (title/summarization)
        // and should not surface as a user-visible chat error.
        for (const [id, pending] of this.pendingMiniCompletions) {
          pending.reject(new Error(rawMessage));
          this.pendingMiniCompletions.delete(id);
        }

        // Same treatment for pending llm_query calls. llm_query_error is also an
        // internal utility-path code (call_llm): the dual-emit from the subprocess
        // means a targeted `llm_query_result` is sent alongside this generic `error`
        // to reject the specific pending promise — this loop is the defensive cleanup
        // for queries that never got a targeted result (subprocess crash, etc.).
        for (const [id, pending] of this.pendingLlmQueries) {
          pending.reject(new Error(rawMessage));
          this.pendingLlmQueries.delete(id);
        }

        if (errorCode === 'mini_completion_error' || errorCode === 'llm_query_error') {
          this.debug(`Ignoring ${errorCode} subprocess error in chat stream`);
          break;
        }

        // Reject pending ensure_session_ready requests (used by branch preflight)
        for (const [id, pending] of this.pendingEnsureSessionReady) {
          pending.reject(new Error(rawMessage));
          this.pendingEnsureSessionReady.delete(id);
        }

        // Reject pending compact/toggle requests
        for (const [id, pending] of this.pendingCompactions) {
          pending.reject(new Error(rawMessage));
          this.pendingCompactions.delete(id);
        }
        for (const [id, pending] of this.pendingAutoCompactionToggles) {
          pending.reject(new Error(rawMessage));
          this.pendingAutoCompactionToggles.delete(id);
        }
        for (const [id, pending] of this.pendingRuntimeConfigUpdates) {
          pending.reject(new Error(rawMessage));
          this.pendingRuntimeConfigUpdates.delete(id);
        }

        // Suppress repeated identical errors to prevent a broken subprocess
        // from flooding the user's session (e.g. EFAULT loop).
        if (rawMessage === this.lastSubprocessError) {
          this.subprocessErrorRepeatCount++;
          if (this.subprocessErrorRepeatCount > PiAgent.MAX_IDENTICAL_SUBPROCESS_ERRORS) {
            this.debug(`Suppressing repeated subprocess error (${this.subprocessErrorRepeatCount}x): ${rawMessage}`);
            break;
          }
        } else {
          this.lastSubprocessError = rawMessage;
          this.subprocessErrorRepeatCount = 1;
        }

        const parsed = parseError(new Error(rawMessage));
        if (parsed.code !== 'unknown_error') {
          this.eventQueue.enqueue({ type: 'typed_error', error: parsed });
        } else {
          this.eventQueue.enqueue({
            type: 'error',
            message: `Pi subprocess error: ${rawMessage}`,
          });
        }

        // Note: The subprocess should follow this with a synthetic agent_end event
        // which will call eventQueue.complete(). If it doesn't, handleSubprocessExit()
        // will complete the queue when the process exits.
        break;
      }

      default:
        this.debug(`Unknown subprocess message type: ${type}`);
    }
  }

  /**
   * Forward a Pi SDK event from the subprocess through the event adapter.
   */
  private handleSubprocessEvent(event: Record<string, unknown>): void {
    // The subprocess sends Pi SDK AgentSessionEvent objects serialized as JSON.
    // Feed them through PiEventAdapter to convert to SelectionEvents.

    // Detect session MCP tool completions (same pattern as in-process version)
    const eventType = event.type as string;
    let adaptedEvent = event;

    if (eventType === 'tool_execution_start') {
      const toolName = event.toolName as string;
      const toolCallId = event.toolCallId as string | undefined;
      if (toolName?.startsWith('session__') || toolName?.startsWith('mcp__session__')) {
        // Session tool tracking is handled by the subprocess; it sends
        // session_tool_completed events when appropriate.
      }

      // Deterministic metadata bridge: if subprocess event lacks toolMetadata,
      // inject metadata captured from pre_tool_use_request before stripping.
      const existingMeta = event.toolMetadata as { intent?: string; displayName?: string } | undefined;
      if (toolCallId && !existingMeta) {
        const cached = this.preToolMetadataByCallId.get(toolCallId);
        if (cached && (cached.intent || cached.displayName)) {
          adaptedEvent = {
            ...event,
            toolMetadata: {
              intent: cached.intent,
              displayName: cached.displayName,
              source: 'interceptor',
            },
          };
          this.debug(`Injected pre-tool metadata for ${toolName} (${toolCallId}) from bridge cache`);
        }
      }
    }

    if (eventType === 'tool_execution_end') {
      const toolCallId = event.toolCallId as string | undefined;
      if (toolCallId) {
        this.preToolMetadataByCallId.delete(toolCallId);
      }
    }

    // Adapt event to CraftAgentEvents
    // The event adapter expects typed PiAgentEvent/AgentSessionEvent objects,
    // but since we're receiving plain JSON, we cast through unknown.
    for (const agentEvent of this.adapter.adaptEvent(adaptedEvent as any)) {
      // Track Read tool calls for prerequisite checking
      if (agentEvent.type === 'tool_start' && agentEvent.toolName === 'Read') {
        this.prerequisiteManager.trackReadTool(agentEvent.input as Record<string, unknown>);
      }
      // Reset prerequisite state on compaction (LLM loses guide content)
      if (agentEvent.type === 'info' && typeof agentEvent.message === 'string' && agentEvent.message.startsWith('Compacted')) {
        this.resetPrerequisiteState();
      }

      // Fire PostToolUse / PostToolUseFailure hook events (fire-and-forget)
      if (agentEvent.type === 'tool_result') {
        const hookEvent = agentEvent.isError ? 'PostToolUseFailure' : 'PostToolUse';
        this.emitAutomationEvent(hookEvent, {
          hook_event_name: hookEvent,
          tool_name: agentEvent.toolName ?? (event.toolName as string) ?? 'unknown',
          tool_input: (agentEvent.input as Record<string, unknown> | undefined),
          tool_use_id: (event.toolCallId as string | undefined),
          ...(agentEvent.isError
            ? { error: typeof agentEvent.result === 'string' ? agentEvent.result : undefined }
            : { tool_response: typeof agentEvent.result === 'string' ? agentEvent.result : undefined }),
        });
      }

      if (agentEvent.type === 'info' && typeof agentEvent.message === 'string' && agentEvent.message.includes('Compacting') && !this.preCompactEmitted) {
        this.preCompactEmitted = true;
        this.emitAutomationEvent('PreCompact', {
          hook_event_name: 'PreCompact',
          compact_trigger: 'auto',
        });
      }
      if (agentEvent.type === 'info' && typeof agentEvent.message === 'string' && agentEvent.message.startsWith('Compacted')) {
        this.preCompactEmitted = false;
      }

      this.eventQueue.enqueue(agentEvent);
    }

    // Turn-completion is now adapter-driven so overflow recovery can hold the
    // queue open across the SDK's compaction → agent.continue() sequence
    // (see PiEventAdapter overflow state machine). The adapter returns true
    // when the queue should terminate — either on a normal agent_end with no
    // recovery in flight, or on a compaction_end failure that drains a held
    // overflow.
    if (this.adapter.shouldCompleteQueue(eventType === 'agent_end')) {
      this.eventQueue.complete();
    }
  }

  /**
   * Tighten-only PreToolUse automation. Fail-open: exceptions leave the
   * built-in allow/modify result unchanged.
   */
  private applyAutomationToolDecision(
    toolName: string,
    input: Record<string, unknown>,
    toolCallId: string | undefined,
    sessionId: string,
  ): { type: 'block'; reason: string } | { type: 'continue'; input: Record<string, unknown>; modified: boolean } {
    try {
      const decision = this.automationSystem?.evaluateToolDecision({
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: input,
        tool_use_id: toolCallId,
      });
      if (decision?.decision === 'block') {
        const label = decision.automationName ?? decision.matcherId;
        const reason = decision.reason
          ? `Blocked by automation "${label}": ${decision.reason}`
          : `Blocked by automation "${label}"`;
        void this.automationSystem?.recordDecisionHistory({
          matcherId: decision.matcherId,
          event: 'PreToolUse',
          sourceSessionId: sessionId,
          reason,
        });
        return { type: 'block', reason };
      }
      if (decision?.decision === 'modify' && decision.updatedInput && Object.keys(decision.updatedInput).length > 0) {
        return { type: 'continue', input: { ...input, ...decision.updatedInput }, modified: true };
      }
    } catch (err) {
      this.debug(`Automation tool decision failed: ${err}`);
    }
    return { type: 'continue', input, modified: false };
  }

  /**
   * Handle a pre_tool_use_request from the subprocess.
   * Runs the centralized permission pipeline and sends the decision back.
   */
  private async handlePreToolUseRequest(req: {
    requestId: string;
    toolName: string;
    toolCallId?: string;
    input: Record<string, unknown>;
  }): Promise<void> {
    const { requestId, toolName, toolCallId } = req;
    const input = recoverKnownToolInputFromIntent(toolName, req.input);
    const inputWasRecovered = input !== req.input;
    const debugSessionId = this.config.session?.id || this._sessionId;
    this.debug(`PreToolUse request from subprocess: ${toolName} (${requestId}, sessionId=${debugSessionId})`);

    // Capture metadata BEFORE centralized checks strip it out.
    // This bridge is deterministic and avoids relying solely on side-channel store lookups.
    const preIntent = typeof input._intent === 'string' ? input._intent : undefined;
    const preDisplayName = typeof input._displayName === 'string' ? input._displayName : undefined;
    if (toolCallId && (preIntent || preDisplayName)) {
      this.preToolMetadataByCallId.set(toolCallId, {
        intent: preIntent,
        displayName: preDisplayName,
        capturedAt: Date.now(),
      });
      this.debug(`Captured pre-tool metadata for ${toolName} (${toolCallId}, sessionId=${debugSessionId}): intent=${!!preIntent}, displayName=${!!preDisplayName}`);
    }

    const rootPath = this.config.workspace.rootPath ?? this.workingDirectory;
    const workspaceSlug = extractWorkspaceSlug(rootPath, this.config.workspace.id);
    const sessionId = this.config.session?.id || this._sessionId;
    const plansFolderPath = sessionId
      ? getSessionPlansPath(rootPath, sessionId)
      : undefined;
    const dataFolderPath = sessionId
      ? getSessionDataPath(rootPath, sessionId)
      : undefined;

    const checkResult = runPreToolUseChecks({
      toolName,
      input,
      sessionId,
      permissionMode: this.permissionManager.getPermissionMode(),
      workspaceRootPath: rootPath,
      workspaceId: workspaceSlug,
      plansFolderPath,
      dataFolderPath,
      workingDirectory: this.config.session?.workingDirectory,
      activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
      allSourceSlugs: this.sourceManager.getAllSources().map(s => s.config.slug),
      hasSourceActivation: !!this.onSourceActivationRequest,
      permissionManager: this.permissionManager,
      prerequisiteManager: this.prerequisiteManager,
      onDebug: (msg) => this.debug(`PreToolUse(sessionId=${sessionId}): ${msg}`),
    });

    const emitPreToolUse = async (toolInput: Record<string, unknown>) => {
      await this.emitAutomationEvent('PreToolUse', {
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: toolCallId,
      });
    };

    const sendPermissionBlock = (reason: string) => {
      const diagnostics = getPermissionModeDiagnostics(sessionId);
      this.debug(`__PERMISSION_BLOCK__${JSON.stringify({
        sessionId,
        toolName,
        effectiveMode: diagnostics.permissionMode,
        modeVersion: diagnostics.modeVersion,
        changedBy: diagnostics.lastChangedBy,
        changedAt: diagnostics.lastChangedAt,
        reason,
      })}`);
      this.send({ type: 'pre_tool_use_response', requestId, action: 'block', reason });
    };

    const finishAllowedTool = async (candidateInput: Record<string, unknown>, alreadyModified: boolean) => {
      const decided = this.applyAutomationToolDecision(toolName, candidateInput, toolCallId, sessionId);
      if (decided.type === 'block') {
        sendPermissionBlock(decided.reason);
        return;
      }
      const shellCommand = toolName === 'Bash' && typeof decided.input.command === 'string'
        ? decided.input.command
        : null;
      if (shellCommand && isOfficecliShellCommand(shellCommand) && !this.managedOfficecliShellAvailable) {
        sendPermissionBlock('Selection\'s app-managed OfficeCLI runtime or official resources are unavailable. Repair or reinstall Selection before running OfficeCLI shell commands.');
        return;
      }
      if (shellCommand && this.managedOfficecliBinaryPath) {
        const commandForComparison = process.platform === 'win32' ? shellCommand.toLowerCase() : shellCommand;
        const binaryForComparison = process.platform === 'win32'
          ? this.managedOfficecliBinaryPath.toLowerCase()
          : this.managedOfficecliBinaryPath;
        if (commandForComparison.includes(binaryForComparison)) {
          sendPermissionBlock('Direct invocation of Selection\'s platform OfficeCLI binary is blocked because it bypasses the Word Heading/TOC compatibility repair. Invoke `officecli` through the trusted PATH wrapper instead.');
          return;
        }
      }
      await emitPreToolUse(decided.input);
      if (decided.modified || alreadyModified) {
        this.send({ type: 'pre_tool_use_response', requestId, action: 'modify', input: decided.input });
      } else {
        this.send({ type: 'pre_tool_use_response', requestId, action: 'allow' });
      }
    };

    switch (checkResult.type) {
      case 'allow':
        await finishAllowedTool(input, inputWasRecovered);
        return;

      case 'modify':
        await finishAllowedTool(checkResult.input, true);
        return;

      case 'block': {
        // Built-in permission block: keep the #62 observation event.
        await emitPreToolUse(input);
        sendPermissionBlock(checkResult.reason);
        return;
      }

      case 'source_activation_needed': {
        const { sourceSlug, sourceExists, additionalSourceSlugs } = checkResult;
        const sourceSlugs = [sourceSlug, ...(additionalSourceSlugs ?? [])];
        this.debug(`PreToolUse(sessionId=${sessionId}): Source "${sourceSlugs.join(', ')}" not active, attempting activation...`);

        if (this.onSourceActivationRequest) {
          try {
            for (const slug of sourceSlugs) {
              const activated = await this.onSourceActivationRequest(slug);
              if (!activated) {
                const reason = sourceExists
                  ? `Source "${slug}" is not active. Activate it by @mentioning it in your message or via the source icon at the bottom of the input field.`
                  : `Source "${slug}" is not available yet. It needs to be created and configured first.`;
                this.send({ type: 'pre_tool_use_response', requestId, action: 'block', reason });
                return;
              }
              this.debug(`PreToolUse(sessionId=${sessionId}): Source "${slug}" activated successfully`);
            }
            this.eventQueue.enqueue({
              type: 'source_activated' as const,
              sourceSlug,
              originalMessage: this.getCurrentTurnUserMessage() ?? '',
            });
          } catch (err) {
            const reason = sourceExists
              ? `Source "${sourceSlug}" could not be activated: ${err}`
              : `Source "${sourceSlug}" is not available yet. It needs to be created and configured first.`;
            this.send({ type: 'pre_tool_use_response', requestId, action: 'block', reason });
            return;
          }
        }

        // Re-run pipeline after activation
        const postResult = runPreToolUseChecks({
          toolName,
          input,
          sessionId,
          permissionMode: this.permissionManager.getPermissionMode(),
          workspaceRootPath: rootPath,
          workspaceId: workspaceSlug,
          plansFolderPath,
          dataFolderPath,
          workingDirectory: this.config.session?.workingDirectory,
          activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
          allSourceSlugs: this.sourceManager.getAllSources().map(s => s.config.slug),
          hasSourceActivation: !!this.onSourceActivationRequest,
          permissionManager: this.permissionManager,
          prerequisiteManager: this.prerequisiteManager,
          onDebug: (msg) => this.debug(`PreToolUse(sessionId=${sessionId}): ${msg}`),
        });

        if (postResult.type === 'block') {
          await emitPreToolUse(input);
          sendPermissionBlock(postResult.reason);
        } else if (postResult.type === 'modify') {
          await finishAllowedTool(postResult.input, true);
        } else {
          await finishAllowedTool(input, false);
        }
        return;
      }

      case 'call_llm_intercept':
      case 'spawn_session_intercept':
        // These tools are proxy tools handled via tool_execute_request — just allow
        await emitPreToolUse(input);
        this.send({ type: 'pre_tool_use_response', requestId, action: 'allow' });
        return;

      case 'prompt': {
        if (!this.onPermissionRequest) {
          // No permission handler — allow, then tighten via automations
          await finishAllowedTool(checkResult.modifiedInput ?? input, !!checkResult.modifiedInput);
          return;
        }

        const permRequestId = `pi-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.debug(`PreToolUse(sessionId=${sessionId}): Prompting user for ${toolName} - ${checkResult.description}`);

        // Wait for user response via pendingPermissions
        const permissionPromise = new Promise<boolean>((resolve) => {
          this.pendingPermissions.set(permRequestId, {
            resolve,
            toolName,
          });
        });

        this.emitAutomationEvent('PermissionRequest', {
          hook_event_name: 'PermissionRequest',
          tool_name: toolName,
        });

        this.onPermissionRequest({
          requestId: permRequestId,
          toolName,
          command: checkResult.command,
          description: checkResult.description,
          type: checkResult.promptType,
          appName: checkResult.appName,
          reason: checkResult.reason,
          impact: checkResult.impact,
          requiresSystemPrompt: checkResult.requiresSystemPrompt,
          rememberForMinutes: checkResult.rememberForMinutes,
          commandHash: checkResult.commandHash,
          approvalTtlSeconds: checkResult.approvalTtlSeconds,
        });

        const allowed = await permissionPromise;
        this.pendingPermissions.delete(permRequestId);

        if (!allowed) {
          this.send({ type: 'pre_tool_use_response', requestId, action: 'block', reason: 'Permission denied by user.' });
          return;
        }

        await finishAllowedTool(checkResult.modifiedInput ?? input, !!checkResult.modifiedInput);
        return;
      }
    }
  }

  /**
   * Handle a tool_execute_request from the subprocess.
   * Routes proxy tool calls (MCP, API, session) to the appropriate handler.
   *
   * The subprocess expects responses in the format:
   *   { content: string | ToolContent[]; isError: boolean }
   */
  private async handleToolExecuteRequest(request: {
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<void> {
    // Prerequisite check: block source tools until guide.md is read
    const prereqResult = this.prerequisiteManager.checkPrerequisites(request.toolName);
    if (!prereqResult.allowed) {
      this.send({
        type: 'tool_execute_response',
        requestId: request.requestId,
        result: { content: prereqResult.blockReason!, isError: true },
      });
      return;
    }

    try {
      const result = await this.routeToolCall(request.toolName, request.args);
      this.send({
        type: 'tool_execute_response',
        requestId: request.requestId,
        result,
      });
    } catch (error) {
      this.send({
        type: 'tool_execute_response',
        requestId: request.requestId,
        result: {
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        },
      });
    }
  }

  /**
   * Route a proxy tool call to the appropriate handler based on tool name.
   *
   * - Session tools (SubmitPlan, config_validate, etc.) -> session-tools-core handlers
   * - call_llm -> preExecuteCallLlm (BaseAgent)
   * - mcp__* tools -> MCP server proxy (TODO)
   * - api_* tools -> API source proxy (TODO)
   *
   * Returns a text-only or multimodal result matching the subprocess protocol.
   */
  private async routeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ProxyToolExecutionResult> {
    // Session-scoped tools may be MCP-prefixed or canonical.
    // Normalize the prefix before dispatching to the canonical registry.
    const strippedName = toolName.startsWith('mcp__session__')
      ? toolName.slice('mcp__session__'.length)
      : toolName;

    if (SESSION_TOOL_NAMES.has(strippedName)) {
      return this.executeSessionTool(strippedName, args);
    }

    // MCP source tools — route through centralized pool
    if (this.mcpPool?.isProxyTool(toolName)) {
      return this.mcpPool.callTool(toolName, args);
    }

    // Unknown tool
    return {
      content: `Unknown proxy tool: ${toolName}`,
      isError: true,
    };
  }

  /**
   * Get or create a SessionToolContext for executing session-scoped tools.
   * Cached per agent instance since the workspace/session don't change.
   */
  private resolveCurrentModelSupportsImages(): boolean {
    const modelId = this.config.model || '';
    const runtime = getBackendRuntime(this.config);
    const customModel = runtime.customModels?.find((model) =>
      connectionModelIdsMatch(typeof model === 'string' ? model : model.id, modelId),
    );
    const customModelSupportsImages = customModel && typeof customModel !== 'string'
      ? customModel.supportsImages
      : undefined;
    const registeredModel = getModelById(modelId);
    return customModelSupportsImages
      ?? runtime.customEndpoint?.supportsImages
      ?? registeredModel?.supportsImages
      ?? inferModelSupportsImages(modelId, registeredModel?.name);
  }

  private getSessionToolContext(): SessionToolContext {
    if (this._sessionToolContext) {
      // The project directory can change while the agent stays alive.
      this._sessionToolContext.workingDirectory = this.config.session?.workingDirectory;
      this._sessionToolContext.supportsImages = this.resolveCurrentModelSupportsImages();
      this._sessionToolContext.permissionMode = this.permissionManager.getPermissionMode();
      return this._sessionToolContext;
    }

    const sessionId = this.config.session?.id || '';
    const workspacePath = this.config.workspace.rootPath;
    const workspaceId = this.config.workspace.id;
    const supportsImages = this.resolveCurrentModelSupportsImages();
    this._sessionToolContext = createClaudeContext({
      sessionId,
      workspacePath,
      workspaceId,
      workingDirectory: this.config.session?.workingDirectory,
      supportsImages,
      permissionMode: this.permissionManager.getPermissionMode(),
      onPlanSubmitted: (planPath: string) => {
        setLastPlanFilePath(sessionId, planPath);
        this.onPlanSubmitted?.(planPath);
      },
      onAuthRequest: (request: unknown) => {
        this.onAuthRequest?.(request as any);
      },
    });

    // Attach session self-management bindings (lazy getters from callback registry)
    attachSessionSelfManagementBindings(this._sessionToolContext, sessionId);

    return this._sessionToolContext;
  }

  /**
   * Execute a session-scoped tool by name.
   * Uses the canonical registry from @craft-agent/session-tools-core.
   */
  private async executeSessionTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ProxyToolExecutionResult> {
    try {
      // call_llm uses the shared pre-execution pipeline from BaseAgent
      if (toolName === 'call_llm') {
        try {
          const result = await this.preExecuteCallLlm(args);
          return { content: result.text || '(Model returned empty response)', isError: false };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: `call_llm failed: ${msg}`, isError: true };
        }
      }

      // spawn_session uses the shared pre-execution pipeline from BaseAgent
      if (toolName === 'spawn_session') {
        try {
          const result = await this.preExecuteSpawnSession(args);
          return { content: JSON.stringify(result, null, 2), isError: false };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: `spawn_session failed: ${msg}`, isError: true };
        }
      }

      // browser_tool — single CLI-like tool for all browser actions
      if (toolName === 'browser_tool') {
        const callbacks = getSessionScopedToolCallbacks(this._sessionId);
        const browserFns = callbacks?.browserPaneFns;
        if (!browserFns) {
          return { content: 'Browser window controls are not available. This tool requires the desktop app.', isError: true };
        }

        try {
          const result = await executeBrowserToolCommand({
            command: (args.command as string | string[]) ?? '',
            fns: browserFns,
            sessionId: this._sessionId,
          });

          let content = result.output;
          if (result.image) {
            const sessionPath = getSessionPath(this.config.workspace.rootPath, this._sessionId);
            const imageBuffer = Buffer.from(result.image.data, 'base64');
            const ext = result.image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
            const saved = saveBinaryResponse(sessionPath, `browser-screenshot.${ext}`, imageBuffer, result.image.mimeType);

            if (saved.type === 'file_download') {
              content += [
                '',
                `Saved screenshot: ${saved.path}`,
                '',
                '```image-preview',
                JSON.stringify({
                  src: saved.path,
                  title: 'Browser Screenshot',
                }, null, 2),
                '```',
              ].join('\n');
            } else {
              content += `\n\n[Screenshot captured (${Math.round(result.image.sizeBytes / 1024)}KB ${result.image.mimeType}) but failed to save: ${saved.error}]`;
            }
          }

          return { content, isError: false };
        } catch (error) {
          // Branch on `err.code` (string), not `instanceof CodedError` — the
          // transport reconstructs a plain Error on the receiving side, so
          // class identity is lost across the wire.
          const rawCode = (error as { code?: unknown } | null)?.code;
          const code = typeof rawCode === 'string' ? rawCode : '';
          const msg = error instanceof Error ? error.message : String(error);
          const friendly = mapBrowserToolErrorCode(code) ?? msg;
          return { content: friendly, isError: true };
        }
      }

      const def = SESSION_TOOL_REGISTRY.get(toolName);
      if (!def) {
        return { content: `Unknown session tool: ${toolName}`, isError: true };
      }
      if (!def.handler) {
        return {
          content: `Session tool '${toolName}' is backend-executed (${def.executionMode}) but has no PiAgent adapter implementation.`,
          isError: true,
        };
      }

      const ctx = this.getSessionToolContext();
      const result: SessionToolResult = await def.handler(ctx, args);
      // Preserve MCP-compatible text/image blocks all the way into Pi's model
      // context. The first block is always text, so older string-only event/UI
      // consumers still receive the structured envelope and artifact paths.
      return {
        content: result.content,
        isError: !!result.isError,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.debug(`Session tool ${toolName} failed: ${msg}`);
      return { content: `Session tool error: ${msg}`, isError: true };
    }
  }



  /**
   * Handle session_tool_completed from subprocess.
   *
   * NOTE: For proxy-executed session tools, callbacks (onPlanSubmitted, etc.)
   * are already fired by executeSessionTool() via the SessionToolContext.
   * The subprocess sends this event because handleSessionEvent() detects the
   * mcp__session__ prefix, but we intentionally skip handleSessionMcpToolCompletion()
   * here to avoid double-firing callbacks.
   */
  private handleSessionToolCompleted(msg: Record<string, unknown>): void {
    const toolName = msg.toolName as string;
    const isError = msg.isError as boolean;
    this.debug(`Session tool completed: ${toolName} (isError=${isError})`);
    // Callbacks already handled by executeSessionTool() — no-op.
  }

  /**
   * Handle mini_completion_result from subprocess.
   */
  private handleMiniCompletionResult(msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const text = msg.text as string | null;
    const pending = this.pendingMiniCompletions.get(id);
    if (pending) {
      this.pendingMiniCompletions.delete(id);
      pending.resolve(text);
    }
  }

  /**
   * Handle ensure_session_ready_result from subprocess.
   */
  private handleEnsureSessionReadyResult(msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const sessionId = (msg.sessionId as string | null) ?? null;
    const pending = this.pendingEnsureSessionReady.get(id);
    if (!pending) return;

    this.pendingEnsureSessionReady.delete(id);
    if (sessionId && this.piSessionId !== sessionId) {
      this.piSessionId = sessionId;
      this.config.onSdkSessionIdUpdate?.(sessionId);
    }
    pending.resolve(sessionId);
  }

  /**
   * Handle compact_result from subprocess.
   */
  private handleCompactResult(msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const success = Boolean(msg.success);
    const pending = this.pendingCompactions.get(id);
    if (!pending) return;

    this.pendingCompactions.delete(id);
    if (!success) {
      pending.reject(new Error(String(msg.errorMessage || 'Compaction failed')));
      return;
    }

    const raw = msg.result as Record<string, unknown> | undefined;
    if (!raw) {
      pending.resolve(null);
      return;
    }

    pending.resolve({
      summary: String(raw.summary || ''),
      firstKeptEntryId: String(raw.firstKeptEntryId || ''),
      tokensBefore: Number(raw.tokensBefore || 0),
    });
  }

  /**
   * Handle set_auto_compaction_result from subprocess.
   */
  private handleSetAutoCompactionResult(msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const success = Boolean(msg.success);
    const pending = this.pendingAutoCompactionToggles.get(id);
    if (!pending) return;

    this.pendingAutoCompactionToggles.delete(id);
    if (!success) {
      pending.reject(new Error(String(msg.errorMessage || 'Failed to set auto-compaction')));
      return;
    }

    pending.resolve(Boolean(msg.enabled));
  }

  /**
   * Handle update_runtime_config_result from subprocess.
   */
  private handleRuntimeConfigUpdateResult(msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const success = Boolean(msg.success);
    const pending = this.pendingRuntimeConfigUpdates.get(id);
    if (!pending) return;

    this.pendingRuntimeConfigUpdates.delete(id);
    if (!success) {
      pending.reject(new Error(String(msg.errorMessage || 'Runtime config update failed')));
      return;
    }

    pending.resolve(Boolean(msg.updated ?? true));
  }

  /**
   * Handle subprocess exit.
   */
  private handleSubprocessExit(code: number | null, signal: string | null): void {
    this.debug(`Pi subprocess exited: code=${code}, signal=${signal}`);

    this.subprocess = null;
    this.managedOfficecliShellAvailable = false;
    this.readline = null;
    this.resetSubprocessErrorDedup();
    this.subprocessReady = null;
    this.subprocessReadyResolve = null;

    // If we were processing, emit error + complete
    if (this._isProcessing) {
      const exitReason = signal ? `signal ${signal}` : `code ${code}`;
      this.eventQueue.enqueue({
        type: 'error',
        message: `Pi subprocess exited unexpectedly (${exitReason})`,
      });
      this.eventQueue.complete();
      this.emitStopOnce('error');
    }

    // Reject pending mini completions with error (not null) so callers
    // get a meaningful error instead of silently returning "no response"
    const exitReason = signal ? `signal ${signal}` : `code ${code}`;
    for (const [, pending] of this.pendingMiniCompletions) {
      pending.reject(new Error(`Pi subprocess exited unexpectedly (${exitReason})`));
    }
    this.pendingMiniCompletions.clear();

    // Reject pending llm_query calls (call_llm in-flight during subprocess crash)
    for (const [, pending] of this.pendingLlmQueries) {
      pending.reject(new Error(`Pi subprocess exited unexpectedly (${exitReason})`));
    }
    this.pendingLlmQueries.clear();

    // Reject pending ensure_session_ready requests
    for (const [, pending] of this.pendingEnsureSessionReady) {
      pending.reject(new Error(`Pi subprocess exited unexpectedly (${exitReason})`));
    }
    this.pendingEnsureSessionReady.clear();

    // Reject pending compact/toggle requests
    for (const [, pending] of this.pendingCompactions) {
      pending.reject(new Error(`Pi subprocess exited unexpectedly (${exitReason})`));
    }
    this.pendingCompactions.clear();

    for (const [, pending] of this.pendingAutoCompactionToggles) {
      pending.reject(new Error(`Pi subprocess exited unexpectedly (${exitReason})`));
    }
    this.pendingAutoCompactionToggles.clear();

    for (const [, pending] of this.pendingRuntimeConfigUpdates) {
      pending.reject(new Error(`Pi subprocess exited unexpectedly (${exitReason})`));
    }
    this.pendingRuntimeConfigUpdates.clear();

    // Reject all pending tool executions
    for (const [, pending] of this.pendingToolExecutions) {
      pending.reject(new Error('Pi subprocess exited'));
    }
    this.pendingToolExecutions.clear();

    // Drop any cached pre-tool metadata for the dead subprocess.
    this.preToolMetadataByCallId.clear();
  }

  /**
   * Ask subprocess to create/verify the primary session (without sending a prompt)
   * and return the active Pi session ID.
   */
  private async requestEnsureSessionReady(): Promise<string | null> {
    await this.ensureSubprocess();

    const id = `ensure-ready-${++this.rpcIdCounter}`;
    const timeoutMs = 15_000;

    return new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingEnsureSessionReady.delete(id);
        reject(new Error(`ensure_session_ready timed out after ${Math.floor(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pendingEnsureSessionReady.set(id, {
        resolve: (sessionId) => {
          clearTimeout(timer);
          resolve(sessionId);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.send({ type: 'ensure_session_ready', id });
    });
  }

  /**
   * Ask subprocess to compact the active session context.
   */
  private async requestCompact(customInstructions?: string): Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number } | null> {
    if (!this.preCompactEmitted) {
      this.preCompactEmitted = true;
      this.emitAutomationEvent('PreCompact', {
        hook_event_name: 'PreCompact',
        compact_trigger: 'manual',
      });
    }
    await this.ensureSubprocess();

    const id = `compact-${++this.rpcIdCounter}`;
    // GPT-backed Pi compactions on large conversations can legitimately take 60-120s
    // (single blocking OpenAI summary call, no progress stream). 5 min covers realistic
    // cases; truly hung subprocesses are caught by the stdio death watchdog.
    const timeoutMs = 300_000;

    return new Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number } | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCompactions.delete(id);
        reject(new Error(`compact timed out after ${Math.floor(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pendingCompactions.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.send({ type: 'compact', id, customInstructions });
    });
  }

  /**
   * Ask subprocess to enable/disable auto-compaction.
   */
  private async requestSetAutoCompaction(enabled: boolean): Promise<boolean> {
    await this.ensureSubprocess();

    const id = `set-auto-compaction-${++this.rpcIdCounter}`;
    const timeoutMs = 15_000;

    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAutoCompactionToggles.delete(id);
        reject(new Error(`set_auto_compaction timed out after ${Math.floor(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pendingAutoCompactionToggles.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.send({ type: 'set_auto_compaction', id, enabled });
    });
  }

  /**
   * Ask subprocess to refresh runtime-affecting custom endpoint config in-place.
   */
  private async requestRuntimeConfigUpdate(update: BackendRuntimeUpdate): Promise<boolean> {
    if (!this.subprocess) return true;

    const id = `runtime-config-${++this.rpcIdCounter}`;
    const timeoutMs = 15_000;
    const runtime = update.runtime ?? {};

    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRuntimeConfigUpdates.delete(id);
        reject(new Error(`update_runtime_config timed out after ${Math.floor(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pendingRuntimeConfigUpdates.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.send({
        type: 'update_runtime_config',
        id,
        model: update.model,
        providerType: update.providerType,
        authType: update.authType,
        baseUrl: runtime.baseUrl,
        customEndpoint: runtime.customEndpoint,
        customModels: runtime.customModels,
      });
    });
  }

  /**
   * Ensure branched Pi sessions are backend-ready before first user message.
   * Called by SessionManager during branch creation to avoid creating
   * transcript-only branches without real Pi session context.
   */
  override async ensureBranchReady(): Promise<void> {
    const isBranchedSession = !!this.config.session?.branchFromMessageId;
    if (!isBranchedSession) return;

    // Branched sessions must include parent session path metadata for Pi forking.
    if (!this.config.session?.branchFromSessionPath) {
      throw new Error('Pi branch preflight failed: missing branchFromSessionPath metadata');
    }

    const sessionId = await this.requestEnsureSessionReady();
    if (!sessionId) {
      throw new Error('Pi branch preflight failed: subprocess did not provide a session ID');
    }

    if (this.piSessionId !== sessionId) {
      this.piSessionId = sessionId;
      this.config.onSdkSessionIdUpdate?.(sessionId);
    }
  }

  // ============================================================
  // Chat (AsyncGenerator backed by the subprocess event queue)
  // ============================================================

  protected async *chatImpl(
    messageParam: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    let message = messageParam;
    // Reset state for new turn
    this._isProcessing = true;
    this.abortReason = undefined;
    this.stopEmitted = false;
    this.eventQueue.reset();
    this.currentUserMessage = message;
    this.adapter.startTurn();

    // Fire UserPromptSubmit hook event (fire-and-forget)
    this.emitAutomationEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: message,
    });

    // Refresh session-scoped tool callbacks (for SubmitPlan, source auth, etc.)
    // IMPORTANT: merge (don't replace) so SessionManager-provided browserPaneFns
    // survives across turns.
    const sessionId = this.config.session?.id;
    if (sessionId) {
      mergeSessionScopedToolCallbacks(sessionId, {
        onPlanSubmitted: (planPath) => this.onPlanSubmitted?.(planPath),
        onAuthRequest: (request) => this.onAuthRequest?.(request),
        queryFn: (request) => this.queryLlm(request),
      });
    }

    try {
      // Ensure subprocess is spawned and ready
      try {
        await this.ensureSubprocess();
      } catch (subprocessError) {
        const errorMsg = subprocessError instanceof Error ? subprocessError.message : String(subprocessError);
        this.debug(`Failed to spawn Pi subprocess: ${errorMsg}`);

        // If resume failed, clear and try fresh
        if (this.piSessionId && !options?.isRetry) {
          this.piSessionId = null;
          this.killSubprocess();
          this.clearSessionForRecovery();

          const recoveryContext = this.buildRecoveryContext();
          if (recoveryContext) {
            message = recoveryContext + message;
            this.debug('Injected recovery context into message');
          }

          await this.ensureSubprocess();
        } else {
          throw subprocessError;
        }
      }

      const trimmedMessage = message.trim();
      const compactMatch = trimmedMessage.match(/^\/compact(?:\s+([\s\S]+))?$/i);
      if (compactMatch) {
        const customInstructions = compactMatch[1]?.trim() || undefined;
        const compactResult = await this.requestCompact(customInstructions);
        if (compactResult) {
          yield {
            type: 'info',
            message: `Compacted context to fit within limits (from ~${compactResult.tokensBefore.toLocaleString()} tokens)`,
          };
        } else {
          yield { type: 'info', message: 'Compacted context to fit within limits' };
        }
        yield { type: 'complete' };
        return;
      }

      // Build system prompt
      const projectContext = this.getPinnedProjectContext();
      const systemPrompt = getSystemPrompt(
        undefined, // pinnedPreferencesPrompt
        this.config.debugMode,
        this.config.workspace.rootPath,
        this.config.session?.workingDirectory,
        this.config.systemPromptPreset,
        'Selection Backend', // backendName
        getCoAuthorPreference(), // respect user's includeCoAuthoredBy preference (#576)
        projectContext ?? undefined,
        // Pi sessions support runtime model switching but cannot safely rebuild
        // their registered tool schemas. Keep the prompt aligned with the strict,
        // provider-neutral schemas registered by pi-agent-server.
        false,
      );

      // Build context from sources
      const sourceContext = this.sourceManager.formatSourceState();

      const promptModeDiagnostics = getPermissionModeDiagnostics(this._sessionId)
      this.debug(
        `[ModeSnapshot] sessionId=${this._sessionId} chatPrompt mode=${promptModeDiagnostics.permissionMode} ` +
        `modeVersion=${promptModeDiagnostics.modeVersion} changedBy=${promptModeDiagnostics.lastChangedBy} changedAt=${promptModeDiagnostics.lastChangedAt}`
      )

      // Build context parts using centralized PromptBuilder, split into stable
      // vs volatile (issue #862). Stable blocks (workspace capabilities, working
      // directory) stay in the cached system prefix; volatile blocks (date/time,
      // session_state, source state) ride the user-message tail so a per-turn
      // re-stamp doesn't invalidate the prompt cache. buildVolatileContextParts
      // consumes the one-shot mode-change signal, so it is called exactly once.
      const plansFolderPath = getSessionPlansPath(this.config.workspace.rootPath, this._sessionId);
      const stableParts = this.promptBuilder.buildStableContextParts();
      const volatileParts = this.promptBuilder.buildVolatileContextParts(
        { plansFolderPath },
        sourceContext
      );

      // Process attachments
      const attachmentParts: string[] = [];
      const images: Array<{ type: string; data: string; mimeType: string }> = [];
      const hydratedAttachments = hydrateAttachmentBytes(attachments) || [];
      const missingImages = imageAttachmentsMissingBytes(hydratedAttachments);
      if (missingImages.length > 0) {
        const names = missingImages.map(att => att.name).join(', ');
        throw new Error(`image_bytes_unavailable: Image bytes could not be loaded for the model request: ${names}.`);
      }
      for (const att of hydratedAttachments) {
        const isImage = att.type === 'image' || att.mimeType?.startsWith('image/') === true
        if (isImage && att.base64) {
          images.push({
            type: 'image',
            data: att.base64,
            mimeType: att.mimeType || 'image/png',
          });
          const stored = att.storedPath || att.path
          if (stored) {
            attachmentParts.push(`[Attached image: ${att.name}]\nThe image is included as visual input — look at it. Path: ${stored}`);
          }
        } else if (att.mimeType === 'application/pdf' && att.storedPath) {
          attachmentParts.push(`[Attached PDF: ${att.name}]\n[Stored at: ${att.storedPath}]`);
        } else if (att.type === 'office' && att.storedPath) {
          attachmentParts.push(
            `[Attached Office document: ${att.name}]\n` +
            `[Stored at: ${att.storedPath}]`,
          );
        } else if (att.storedPath) {
          let pathInfo = `[Attached file: ${att.name}]\n[Stored at: ${att.storedPath}]`;
          if (att.markdownPath) {
            pathInfo += `\n[Markdown version: ${att.markdownPath}]`;
          }
          attachmentParts.push(pathInfo);
        }
      }

      // System prompt carries only stable context (issue #862): the system block
      // is pi-ai's cache prefix before all history, so anything volatile here
      // re-stamps the prefix every turn and drops cacheRead to 0. Volatile blocks
      // ride the user-message tail instead — exactly as the Claude path already
      // does (buildTextPrompt / buildSDKUserMessage append context to the tail).
      const fullSystemPrompt = [
        systemPrompt,
        ...stableParts,
      ].filter(Boolean).join('\n\n');

      // User message: volatile context + attachments + the actual message
      // (skill read directive is already prepended to message by BaseAgent.chat())
      const userParts = [
        ...volatileParts,
        ...attachmentParts,
        message,
      ].filter(Boolean);
      const userMessage = userParts.join('\n\n');

      // Send prompt to subprocess
      const turnId = `turn-${++this.rpcIdCounter}`;
      this.send({
        type: 'prompt',
        id: turnId,
        message: userMessage,
        systemPrompt: fullSystemPrompt,
        images: images.length > 0 ? images : undefined,
      });

      // Yield events as they arrive. The source-activation drain controller
      // captures a pending restart on the first triggering tool_result and
      // drains sibling tool_results from the same parallel-tool batch before
      // firing `source_activated` + `forceAbort` — Pi's subprocess only picks
      // up new proxy tools on the next handlePrompt, so the restart is needed
      // here too. Without the drain, sibling tool_results from parallel
      // source_test calls are lost (#790).
      const sourceActivationDrain = new SourceActivationDrainController('fire-on-non-tool-result');
      for await (const event of this.eventQueue.drain()) {
        // Pre-yield check: when we're past capture and the incoming event is
        // not a tool_result, fire BEFORE yielding it (the event belongs to
        // the about-to-be-aborted next turn — letting it through would leak
        // a fragment of the cancelled response into the session journal).
        const preFire = sourceActivationDrain.shouldFireBeforeEvent(event);
        if (preFire) {
          this.debug(`source_test activated "${preFire.sourceSlug}", drained sibling tool_results, restarting turn`);
          yield preFire;
          this.forceAbort(AbortReason.SourceActivated);
          return;
        }

        if (sourceActivationDrain.observe(event, () => this.consumePendingSourceActivationRestart())) {
          yield event;
          continue;
        }

        yield event;
      }

      // Stream-end fallback: queue drained naturally with a captured restart
      // still pending. Fire and return (no further events expected).
      const sourceActivationFireAtEnd = sourceActivationDrain.shouldFireAtBoundary();
      if (sourceActivationFireAtEnd) {
        this.debug(`source_test activated "${sourceActivationFireAtEnd.sourceSlug}", stream ended with pending restart, restarting turn`);
        yield sourceActivationFireAtEnd;
        this.forceAbort(AbortReason.SourceActivated);
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('abort')) {
        if (this.abortReason === AbortReason.PlanSubmitted) {
          return;
        }
        if (this.abortReason === AbortReason.AuthRequest) {
          return;
        }
        return;
      }

      const errorObj = error instanceof Error ? error : new Error(String(error));
      const typedError = this.parsePiError(errorObj);

      if (typedError.code !== 'unknown_error') {
        yield { type: 'typed_error', error: typedError };
      } else {
        yield { type: 'error', message: errorObj.message };
      }

      yield { type: 'complete' };
    } finally {
      this._isProcessing = false;
      this.emitStopOnce('complete');
    }
  }

  // ============================================================
  // Permission Handling
  // ============================================================

  /**
   * Respond to a pending permission request.
   * Permission checking now happens in the main process, so this resolves locally.
   */
  respondToPermission(requestId: string, allowed: boolean, _alwaysAllow?: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.pendingPermissions.delete(requestId);
      pending.resolve(allowed);
    }
  }

  // ============================================================
  // Model Forwarding
  // ============================================================

  async updateRuntimeConfig(update: BackendRuntimeUpdate): Promise<boolean> {
    const previousModel = this.getModel();
    const previousRuntime = getBackendRuntime(this.config);

    this.config = {
      ...this.config,
      providerType: update.providerType ?? this.config.providerType,
      authType: update.authType ?? this.config.authType,
      model: update.model,
      runtime: {
        ...previousRuntime,
        ...(update.runtime ?? {}),
      },
    };
    this._model = update.model;
    this.applyCatalogContextWindow(update.model);

    if (!this.subprocess) {
      this.debug(`Runtime config updated locally (no subprocess): ${previousModel} → ${update.model}`);
      return true;
    }

    const updated = await this.requestRuntimeConfigUpdate({
      ...update,
      providerType: this.config.providerType,
      authType: this.config.authType,
      runtime: getBackendRuntime(this.config),
    });
    this.debug(`Runtime config refreshed in subprocess: ${previousModel} → ${update.model}`);
    return updated;
  }

  private applyCatalogContextWindow(modelId: string): void {
    const contextWindow = resolveCustomModelContextWindow(
      getBackendRuntime(this.config).customModels,
      modelId,
    ) ?? getModelById(modelId)?.contextWindow;
    if (!contextWindow) return;
    this.usageTracker.setContextWindow(contextWindow);
    this.adapter.setContextWindow(contextWindow);
  }

  override setModel(model: string): void {
    const previousModel = this.getModel();
    super.setModel(model);
    this.applyCatalogContextWindow(model);
    // Forward to subprocess so it uses the new model on next turn
    if (this.subprocess) {
      this.debug(`Forwarding model change to subprocess: ${previousModel} → ${model}`);
      this.send({ type: 'set_model', model });
    } else {
      this.debug(`Model updated but no subprocess to forward to: ${previousModel} → ${model}`);
    }
  }

  override setThinkingLevel(level: ThinkingLevel): void {
    const previousLevel = this.getThinkingLevel();
    super.setThinkingLevel(level);
    // Forward to subprocess so it uses the new thinking level on next turn
    if (this.subprocess) {
      this.debug(`Forwarding thinking level change to subprocess: ${previousLevel} → ${level}`);
      this.send({ type: 'set_thinking_level', level });
    } else {
      this.debug(`Thinking level updated but no subprocess to forward to: ${previousLevel} → ${level}`);
    }
  }

  // ============================================================
  // Source / MCP Integration
  // ============================================================

  override async setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): Promise<void> {
    // BaseAgent.setSourceServers() handles:
    //   1. SourceManager state tracking (active slugs)
    //   2. McpClientPool sync (connecting/disconnecting MCP + API sources)
    await super.setSourceServers(mcpServers, apiServers, intendedSlugs);

    // Register pool's proxy tool defs with subprocess so the model can call them.
    this.registerPoolToolsWithSubprocess();
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  isProcessing(): boolean {
    return this._isProcessing;
  }

  private emitLifecycleReadyOnce(): void {
    if (!this.setupEmitted) {
      this.setupEmitted = true;
      this.emitAutomationEvent('Setup', { hook_event_name: 'Setup', source: 'startup' });
    }
    if (!this.sessionStartEmitted) {
      this.sessionStartEmitted = true;
      this.emitAutomationEvent('SessionStart', {
        hook_event_name: 'SessionStart',
        source: this.config.session?.sdkSessionId ? 'resume' : 'startup',
        model: this._model,
      });
    }
  }

  private emitStopOnce(reason: 'complete' | 'abort' | 'error'): void {
    if (this.stopEmitted) return;
    this.stopEmitted = true;
    this.emitAutomationEvent('Stop', { hook_event_name: 'Stop', stop_reason: reason });
  }

  private emitSessionEndOnce(): void {
    if (this.sessionEndEmitted) return;
    this.sessionEndEmitted = true;
    this.emitAutomationEvent('SessionEnd', { hook_event_name: 'SessionEnd' });
  }

  async abort(reason?: string): Promise<void> {
    this.emitStopOnce('abort');

    // Deny all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve(false);
    }
    this.pendingPermissions.clear();

    // Send abort to subprocess
    this.send({ type: 'abort' });
    this.eventQueue.complete();

    // Clear bridge cache for this interrupted turn.
    this.preToolMetadataByCallId.clear();
  }

  forceAbort(reason: AbortReason): void {
    this.emitStopOnce('abort');

    this.abortReason = reason;
    this._isProcessing = false;

    // Reject all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve(false);
    }
    this.pendingPermissions.clear();

    // Reject all pending tool executions
    for (const [, pending] of this.pendingToolExecutions) {
      pending.reject(new Error(`Force aborted: ${reason}`));
    }
    this.pendingToolExecutions.clear();

    // Signal turn complete to wake up any waiting consumers
    this.eventQueue.complete();

    // Clear bridge cache for aborted turn.
    this.preToolMetadataByCallId.clear();

    // For PlanSubmitted and AuthRequest, just interrupt the turn
    if (reason === AbortReason.PlanSubmitted || reason === AbortReason.AuthRequest) {
      return;
    }

    // For other reasons, send abort to subprocess
    this.send({ type: 'abort' });
  }

  /**
   * Redirect mid-stream via Pi SDK's steer().
   * Delivers the message after the current tool finishes, skips remaining
   * queued tools, and continues with full context intact.
   * Events flow through the existing generator — no abort needed.
   */
  override canRedirect(): boolean {
    return this._isProcessing && !!this.subprocess;
  }

  override redirect(message: string): boolean {
    if (!this.canRedirect()) {
      // Not streaming or no subprocess — fall back to abort
      this.forceAbort(AbortReason.Redirect);
      return false;
    }
    this.debug(`Steering mid-stream: "${message.slice(0, 100)}"`);
    this.send({ type: 'steer', message });
    return true;
  }

  // ============================================================
  // Session ID overrides — Pi maintains its own subprocess session id
  // ============================================================

  override getSessionId(): string | null {
    return this.piSessionId;
  }

  override setSessionId(sessionId: string | null): void {
    this.piSessionId = sessionId;
  }

  override setWorkspace(workspace: Workspace): void {
    super.setWorkspace(workspace);
    this.piSessionId = null;
    this._sessionToolContext = null;
    this.killSubprocess();
  }

  override clearHistory(): void {
    this.piSessionId = null;
    this.killSubprocess();
    super.clearHistory();
    this.debug('History cleared - next chat will start new subprocess');
  }

  destroy(): void {
    this.emitSessionEndOnce();
    this.stopConfigWatcher();

    // Unregister session-scoped tool callbacks
    if (this.config.session?.id) {
      unregisterSessionScopedToolCallbacks(this.config.session.id);
    }

    this._sessionToolContext = null;
    // Pool clients are owned by the main process — don't close them here.
    this.killSubprocess();
    this.debug('PiAgent destroyed');
  }

  async disposeForRestart(): Promise<void> {
    this.stopConfigWatcher();

    if (this.config.session?.id) {
      unregisterSessionScopedToolCallbacks(this.config.session.id);
    }

    this._sessionToolContext = null;
    await this.killSubprocessGracefully();
    this.debug('PiAgent disposed for restart');
  }

  /**
   * Reconnect by killing subprocess -- next chat() will spawn fresh.
   */
  async reconnect(): Promise<void> {
    this.killSubprocess();
    this.debug('PiAgent reconnected (subprocess will be respawned on next chat)');
  }

  /**
   * Gracefully stop the subprocess and wait briefly for the child to exit.
   * Used before an idle runtime restart so we don't leave transient children behind.
   */
  private async killSubprocessGracefully(timeoutMs = 2_000): Promise<void> {
    const child = this.subprocess;
    if (!child) {
      this.killSubprocess();
      return;
    }

    const pid = child.pid;
    const waitForExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      if (child.exitCode !== null || child.signalCode) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    try {
      this.send({ type: 'shutdown' });
    } catch {
      // stdin may already be closed
    }

    child.kill('SIGTERM');
    let result = await Promise.race([
      waitForExit,
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (!result && this.subprocess === child) {
      this.debug(`Pi subprocess ${pid ?? '(unknown pid)'} did not exit after ${timeoutMs}ms; sending SIGKILL`);
      child.kill('SIGKILL');
      result = await Promise.race([
        waitForExit,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 1_000)),
      ]);
    }

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.subprocess === child) {
      this.subprocess = null;
    }
    this.managedOfficecliShellAvailable = false;
    this.subprocessReady = null;
    this.subprocessReadyResolve = null;
    this.callbackPort = 0;
    this.preToolMetadataByCallId.clear();
    this.adapter.resetOverflowState();

    if (result) {
      this.debug(`Pi subprocess ${pid ?? '(unknown pid)'} stopped for restart: code=${result.code}, signal=${result.signal}`);
    } else {
      this.debug(`Pi subprocess ${pid ?? '(unknown pid)'} stop timed out after SIGKILL`);
    }
  }

  /**
   * Kill the subprocess and clean up resources.
   */
  private killSubprocess(): void {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.subprocess) {
      // Try graceful shutdown first
      try {
        this.send({ type: 'shutdown' });
      } catch {
        // stdin may already be closed
      }
      this.subprocess.kill('SIGTERM');
      this.subprocess = null;
    }
    this.managedOfficecliShellAvailable = false;

    this.subprocessReady = null;
    this.subprocessReadyResolve = null;
    this.callbackPort = 0;
    this.preToolMetadataByCallId.clear();

    // Clear any in-flight overflow-recovery state so a stale fallback timer
    // doesn't fire on a torn-down adapter.
    this.adapter.resetOverflowState();
  }

  // ============================================================
  // Mini Completion (for title generation + summarization)
  // ============================================================

  /**
   * Run a simple text completion via the subprocess.
   * Sends a mini_completion request and waits for the result.
   */
  async runMiniCompletion(prompt: string): Promise<string | null> {
    // If subprocess isn't running, spawn it
    await this.ensureSubprocess();

    const id = `mini-${++this.rpcIdCounter}`;
    const resultPromise = new Promise<string | null>((resolve, reject) => {
      this.pendingMiniCompletions.set(id, { resolve, reject });
    });

    this.send({ type: 'mini_completion', id, prompt });

    // Keep this aligned with the subprocess-side queryLlm timeout.
    const timeout = new Promise<string | null>((resolve) => {
      setTimeout(() => {
        if (this.pendingMiniCompletions.has(id)) {
          this.pendingMiniCompletions.delete(id);
          this.debug(`[runMiniCompletion] Timed out after ${LLM_QUERY_TIMEOUT_MS / 1000}s`);
          resolve(null);
        }
      }, LLM_QUERY_TIMEOUT_MS);
    });

    const text = await Promise.race([resultPromise, timeout]);
    this.debug(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
    return text;
  }

  /**
   * Execute an LLM query via the subprocess.
   * Used by session-scoped tool callbacks (call_llm).
   *
   * Sends the full LLMQueryRequest over the `llm_query` RPC so the subprocess's
   * model-aware queryLlm() can honor `request.model`, `request.systemPrompt`,
   * and (transitively via buildCallLlmRequest) `request.outputSchema`.
   * See packages/shared/CLAUDE.md → "queryLlm backend contract" and
   * packages/pi-agent-server/src/index.ts → handleLlmQuery for the invariant.
   */
  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    this.debug('[PiAgent.queryLlm] Starting');

    await this.ensureSubprocess();

    const id = `llm-${++this.rpcIdCounter}`;
    const resultPromise = new Promise<LLMQueryResult>((resolve, reject) => {
      this.pendingLlmQueries.set(id, { resolve, reject });
    });

    this.send({ type: 'llm_query', id, request });

    // Keep this aligned with the subprocess-side queryLlm timeout.
    const timeout = new Promise<LLMQueryResult>((_, reject) => {
      setTimeout(() => {
        if (this.pendingLlmQueries.has(id)) {
          this.pendingLlmQueries.delete(id);
          reject(new Error(`queryLlm timed out after ${LLM_QUERY_TIMEOUT_MS / 1000}s`));
        }
      }, LLM_QUERY_TIMEOUT_MS);
    });

    return Promise.race([resultPromise, timeout]);
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Resolve working directory to an absolute path.
   * BaseAgent stores paths with tilde (~) but Node.js spawn doesn't expand tilde.
   */
  private resolvedCwd(): string {
    const wd = this.workingDirectory;
    if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
    if (wd === '~') return homedir();
    return wd;
  }

  // ============================================================
  // Error Parsing
  // ============================================================

  /**
   * Parse a Pi error into a typed AgentError.
   */
  private parsePiError(error: Error): AgentError {
    const errorMessage = error.message.toLowerCase();

    // Auth errors
    if (
      errorMessage.includes('api key') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('401') ||
      errorMessage.includes('authentication')
    ) {
      // For OAuth connections, attempt token refresh before giving up
      if (this.config.authType === 'oauth') {
        this.refreshAndPushTokens().catch(err => {
          this.debug(`Token refresh from parsePiError failed: ${err}`);
        });
      }

      return {
        code: 'invalid_api_key',
        title: 'Invalid API Key',
        message: 'Your API key was rejected. Check your credentials in Settings.',
        actions: [
          { key: 's', label: 'Update API key', command: '/settings', action: 'settings' },
        ],
        canRetry: this.config.authType === 'oauth',
        originalError: error.message,
      };
    }

    // Rate limiting
    if (errorMessage.includes('rate') || errorMessage.includes('429')) {
      return {
        code: 'rate_limited',
        title: 'Rate Limited',
        message: 'Too many requests. Please wait a moment before trying again.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 5000,
        originalError: error.message,
      };
    }

    // Service errors
    if (
      errorMessage.includes('500') ||
      errorMessage.includes('502') ||
      errorMessage.includes('503') ||
      errorMessage.includes('service') ||
      errorMessage.includes('overloaded')
    ) {
      return {
        code: 'service_error',
        title: 'Service Error',
        message: 'The AI service is temporarily unavailable. Please try again.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 2000,
        originalError: error.message,
      };
    }

    // Network errors
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('fetch failed')
    ) {
      return {
        code: 'network_error',
        title: 'Connection Error',
        message: 'Could not connect to the server. Check your internet connection.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
        originalError: error.message,
      };
    }

    // Fall back to shared error parsing
    return parseError(error);
  }

  // ============================================================
  // Debug
  // ============================================================

  protected override debug(message: string): void {
    this.onDebug?.(`[pi] ${message}`);
  }
}

// Alias for consistency with other backend naming
export { PiAgent as PiBackend };
