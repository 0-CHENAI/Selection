/**
 * Spawn Session Tool (spawn_session)
 *
 * Session-scoped tool that enables the main agent to create independent sessions
 * with configurable connection, model, sources, and an initial prompt.
 *
 * Two modes:
 * - help=true: Returns available connections, models, and sources
 * - Default: Creates a first-class child session. mode=background (default)
 *   returns immediately and wakes the parent on completion; mode=wait
 *   blocks until the child finishes (or times out).
 */

import type { SpawnSessionMode, SpawnSessionResult, SpawnSessionHelpResult } from './base-agent.ts';

export const DEFAULT_SPAWN_SESSION_MODE: SpawnSessionMode = 'background';
export const DEFAULT_SPAWN_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_SPAWN_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

export function resolveSpawnSessionMode(raw: unknown): SpawnSessionMode {
  return raw === 'wait' ? 'wait' : DEFAULT_SPAWN_SESSION_MODE;
}

export function resolveSpawnWaitTimeoutMs(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_SPAWN_WAIT_TIMEOUT_MS;
  return Math.min(Math.max(1, Math.floor(n)), MAX_SPAWN_WAIT_TIMEOUT_MS);
}

export type SpawnSessionFn = (input: Record<string, unknown>) => Promise<SpawnSessionResult | SpawnSessionHelpResult>;

// Tool result type - matches what the SDK expects
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export interface SpawnSessionToolOptions {
  sessionId: string;
  /**
   * Lazy resolver for the spawn session callback.
   * Called at execution time to get the current callback from the session registry.
   */
  getSpawnSessionFn: () => SpawnSessionFn | undefined;
}

export function createSpawnSessionTool(options: SpawnSessionToolOptions) {
  return {
    name: 'spawn_session',
    handler: async (args: Record<string, unknown>) => {
      const spawnFn = options.getSpawnSessionFn();
      if (!spawnFn) {
        return errorResponse('spawn_session is not available in this context.');
      }

      try {
        const result = await spawnFn(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        if (error instanceof Error) {
          return errorResponse(`spawn_session failed: ${error.message}`);
        }
        throw error;
      }
    },
  };
}
