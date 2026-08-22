/**
 * Session Tools Core
 *
 * Shared utilities for session-scoped tools used by both
 * Claude (in-process) and Codex (subprocess) implementations.
 *
 * @packageDocumentation
 */

// Types
export type {
  // Credential types
  CredentialInputMode,

  // Service types
  GoogleService,
  SlackService,
  MicrosoftService,

  // Auth request types
  AuthRequestType,
  BaseAuthRequest,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  AuthRequest,
  AuthResult,

  // IPC types
  CallbackMessage,

  // Tool result types
  TextContent,
  ImageContent,
  ToolContent,
  ToolResult,

  // Developer feedback
  DeveloperFeedback,

  // Validation types
  ValidationIssue,
  ValidationResult,

  // Source config types
  SourceType,
  McpTransport,
  McpAuthType,
  ApiAuthType,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConfig,
  ConnectionStatus,
} from './types.ts';

export type {
  OfficeErrorCategory,
  OfficeStructuredError,
  StructuredWarning,
  ArtifactRef,
  FinalizationCheck,
  FinalizationEvidence,
  OfficeResultEnvelope,
  OfficeGuideName,
  OfficecliManifest,
} from './office-types.ts';

// Response helpers
export {
  successResponse,
  errorResponse,
  textContent,
  multiBlockResponse,
} from './response.ts';

// Source helpers
export {
  getSourcePath,
  getSourceConfigPath,
  getSourceGuidePath,
  sourceExists,
  sourceConfigExists,
  loadSourceConfig,
  listSourceSlugs,
  getSkillPath,
  getSkillMdPath,
  skillExists,
  skillMdExists,
  listSkillSlugs,
  generateRequestId,
  // Multi-header credential helpers
  detectCredentialMode,
  getEffectiveHeaderNames,
} from './source-helpers.ts';

// Validation
export {
  // Result helpers
  validResult,
  invalidResult,
  mergeResults,

  // Formatting
  formatValidationResult,

  // JSON utilities
  readJsonFile,
  validateJsonFileHasFields,
  zodErrorToIssues,

  // Slug validation
  SLUG_REGEX,
  validateSlug,

  // Skill validation
  SkillMetadataSchema,
  validateSkillContent,

  // Source validation
  SOURCE_CONFIG_REQUIRED_FIELDS,
  SOURCE_TYPES,
  validateSourceConfigBasic,
} from './validation.ts';

// Context interface
export type {
  SessionToolContext,
  SessionToolCallbacks,
  FileSystemInterface,
  CredentialManagerInterface,
  ValidatorInterface,
  LoadedSource,
  // MCP validation types
  StdioMcpConfig,
  HttpMcpConfig,
  StdioValidationResult,
  McpValidationResult,
  ApiTestResult,
  // Session self-management types
  SessionInfo,
  SessionListItem,
  ListSessionsOptions,
  ListSessionsResult,
  BackgroundTaskInfo,
  SendAgentMessageResult,
  ResolvedLabelsResult,
  ResolvedStatusResult,
  CreateTaskInput,
  CreateTaskResult,
  RunTaskInput,
  RunTaskResult,
  RunTaskNodeState,
  GetTaskResultsInput,
  TaskResultsPayload,
} from './context.ts';

export { createNodeFileSystem } from './context.ts';

// Handlers
export {
  // SubmitPlan
  handleSubmitPlan,
  // Config Validate
  handleConfigValidate,
  // Skill Validate
  handleSkillValidate,
  // Mermaid Validate
  handleMermaidValidate,
  // Source Test
  handleSourceTest,
  // OAuth Triggers
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
  // Credential Prompt
  handleCredentialPrompt,
  // Update Preferences
  handleUpdatePreferences,
  // Transform Data
  handleTransformData,
  // Script Sandbox
  handleScriptSandbox,
  // Render Template
  handleRenderTemplate,
  // Send Developer Feedback
  handleSendDeveloperFeedback,
  // Office documents
  handleOfficeDocumentInspect,
  handleOfficeDocumentEdit,
  handleOfficeDocumentGuide,
  handleOfficeDocumentPreview,
  handleOfficeDocumentFinalize,
  releaseOfficePreviewSession,
  releaseOfficeGuideSession,
} from './handlers/index.ts';

export type {
  SubmitPlanArgs,
  ConfigValidateArgs,
  SkillValidateArgs,
  MermaidValidateArgs,
  SourceTestArgs,
  SourceOAuthTriggerArgs,
  GoogleOAuthTriggerArgs,
  SlackOAuthTriggerArgs,
  MicrosoftOAuthTriggerArgs,
  CredentialPromptArgs,
  UpdatePreferencesArgs,
  TransformDataArgs,
  ScriptSandboxArgs,
  RenderTemplateArgs,
  SendDeveloperFeedbackArgs,
  OfficeDocumentInspectArgs,
  OfficeDocumentEditArgs,
  OfficeDocumentGuideArgs,
  OfficeDocumentPreviewArgs,
  OfficeDocumentFinalizeArgs,
} from './handlers/index.ts';

// Tool definitions — single source of truth
export {
  // Individual Zod schemas
  SubmitPlanSchema,
  ConfigValidateSchema,
  SkillValidateSchema,
  MermaidValidateSchema,
  SourceTestSchema,
  SourceOAuthTriggerSchema,
  CredentialPromptSchema,
  CallLlmSchema,
  UpdatePreferencesSchema,
  TransformDataSchema,
  ScriptSandboxSchema,
  RenderTemplateSchema,
  OfficeDocumentInspectSchema,
  OfficeDocumentEditSchema,
  OfficeDocumentGuideSchema,
  OfficeDocumentPreviewSchema,
  OfficeDocumentFinalizeSchema,
  // Browser tool schema
  BrowserToolSchema,
  // Developer feedback schema
  SendDeveloperFeedbackSchema,
  // Descriptions
  TOOL_DESCRIPTIONS,
  // Registry
  SESSION_TOOL_DEFS,
  SESSION_TOOL_NAMES,
  SESSION_BACKEND_TOOL_NAMES,
  SESSION_REGISTRY_TOOL_NAMES,
  SESSION_SAFE_ALLOWED_TOOL_NAMES,
  SESSION_SAFE_BLOCKED_TOOL_NAMES,
  SESSION_TOOL_REGISTRY,
  // Filtered helper views
  getSessionToolDefs,
  getSessionToolNames,
  getSessionBackendToolNames,
  getSessionRegistryToolNames,
  getSessionToolRegistry,
  getSessionSafeAllowedToolNames,
  getSessionSafeBlockedToolNames,
  // JSON Schema converter
  getToolDefsAsJsonSchema,
} from './tool-defs.ts';

export {
  OFFICE_STANDARD_TASK_HINT,
  OFFICE_STANDARD_TASK_SEQUENCE,
} from './office-standard-task.ts';

export {
  OFFICE_WORKFLOW_PROMPT,
  OFFICE_DOCUMENT_INSPECT_DESCRIPTION,
  OFFICE_DOCUMENT_EDIT_DESCRIPTION,
  OFFICE_DOCUMENT_GUIDE_DESCRIPTION,
  OFFICE_DOCUMENT_PREVIEW_DESCRIPTION,
  OFFICE_DOCUMENT_FINALIZE_DESCRIPTION,
  OFFICE_MAX_INLINE_BATCH_COMMANDS,
  OFFICE_MAX_INLINE_BATCH_CHARS,
  OFFICE_MAX_BATCH_FILE_BYTES,
} from './office-workflow.ts';

export {
  officecliBinaryName,
  resolveOfficecliBinary,
  resolveOfficecliRuntime,
} from './runtime/officecli.ts';

export {
  resolveOfficecliResources,
  diagnoseOfficecliResourceFailure,
  clearOfficecliManifestCache,
} from './runtime/office-manifest.ts';

export {
  buildOfficeEnvironment,
  chooseOfficeWorkingDirectory,
  executeOfficeCommand,
  flushOfficeResidentLease,
  getOfficeArtifactRevision,
  hasOpenOfficeResidentLease,
  officeSessionArtifactDirectory,
  wasOfficeArtifactMutatedBySession,
  releaseOfficeRuntimeSession,
  clearOfficeRuntimeState,
} from './runtime/office-coordinator.ts';
export type {
  OfficecliBinarySource,
  ResolvedOfficecliBinary,
  ResolveOfficecliOptions,
} from './runtime/officecli.ts';

export type {
  SessionToolExecutionMode,
  SessionToolSafeMode,
  SessionToolDef,
  RegistrySessionToolDef,
  BackendSessionToolDef,
  SessionToolHandler,
  JsonSchemaToolDef,
  SessionToolFilterOptions,
  SessionToolNameOptions,
} from './tool-defs.ts';
