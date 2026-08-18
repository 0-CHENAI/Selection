/**
 * Agent Backend Abstraction Layer
 *
 * Pi is the only supported runtime. Use createAgent() / createBackend().
 */

// Core types
export type {
  AgentBackend,
  AgentProvider,
  CoreBackendConfig,
  BackendConfig,
  BackendHostRuntimeContext,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceChangeCallback,
  SourceActivationCallback,
  ChatOptions,
  RecoveryMessage,
  SdkMcpServerConfig,
  LlmAuthType,
  LlmProviderType,
  PostInitResult,
} from './types.ts';

// Enums need to be exported as values, not just types
export { AbortReason } from './types.ts';

// Factory
export {
  createBackend,
  createAgent,
  detectProvider,
  getAvailableProviders,
  isProviderAvailable,
  // LLM Connection support
  connectionTypeToProvider,
  connectionAuthTypeToBackendAuthType,
  resolveSessionConnection,
  resolveBackendContext,
  resolveSetupTestConnectionHint,
  createConfigFromConnection,
  createBackendFromConnection,
  createBackendFromResolvedContext,
  initializeBackendHostRuntime,
  resolveBackendHostTooling,
  fetchBackendModels,
  validateStoredBackendConnection,
  providerTypeToAgentProvider,
  // Capabilities and utilities
  BACKEND_CAPABILITIES,
  resolveModelForProvider,
  getDefaultAuthType,
  cleanupSourceRuntimeArtifacts,
  testBackendConnection,
  // Connection validation
  validateConnection,
} from './factory.ts';

// Shared infrastructure
export { BaseEventAdapter } from './base-event-adapter.ts';
export { EventQueue } from './event-queue.ts';

export { PiEventAdapter } from './pi/event-adapter.ts';

// Agent implementations are imported directly by factory.ts
// Consumers should use createAgent() / createBackend() instead of concrete classes
