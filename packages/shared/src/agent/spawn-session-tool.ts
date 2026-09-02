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

import type {
  SpawnSessionHelpResult,
  SpawnSessionMode,
  SpawnSessionQualification,
  SpawnSessionResult,
} from './base-agent.ts';

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

/** Build the same structured contract for distinct spawn_session calls in one assistant turn. */
export function synthesizeFanOutQualification(
  candidates: Array<{ name?: string; prompt?: string }>,
): SpawnSessionQualification | undefined {
  const tracks: SpawnSessionQualification['tracks'] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const name = candidate.name?.trim()
      || candidate.prompt?.trim().split(/\n/, 1)[0]?.trim()
      || ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    const input = candidate.prompt?.trim() || name
    tracks.push({
      name,
      input,
      expectedOutput: `Findings for ${name}`,
      evidence: `Primary sources and tool output for ${name}`,
      toolKinds: ['web_search'],
    })
  }
  if (tracks.length < 2) return undefined
  return {
    tracks,
    parallelBenefit: 'Each track investigates an independent subject and can run without waiting on the others.',
    finalAggregation: 'The coordinator compares worker findings and presents one combined answer.',
  }
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

const SPAWN_QUALIFICATION_FAILURE_PREFIXES = [
  'Unable to create Swarm workers',
  '无法创建 Swarm 子代理',
  'Swarm-Worker konnten nicht erstellt werden',
  'No se pudieron crear workers de Swarm',
  'Swarmワーカーを作成できません',
  'Nem hozhatók létre Swarm workerek',
  'Nie można utworzyć workerów Swarm',
]

/**
 * Avoid nesting "spawn_session failed:" on messages that are already a complete
 * user-facing spawn error (especially localized qualification failures).
 */
export function wrapSpawnSessionToolError(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return 'spawn_session failed'
  if (/^spawn_session failed:/i.test(trimmed) || /^Error:/i.test(trimmed)) return trimmed
  if (SPAWN_QUALIFICATION_FAILURE_PREFIXES.some(prefix => trimmed.startsWith(prefix))) return trimmed
  return `spawn_session failed: ${trimmed}`
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
          return errorResponse(wrapSpawnSessionToolError(error.message));
        }
        throw error;
      }
    },
  };
}
