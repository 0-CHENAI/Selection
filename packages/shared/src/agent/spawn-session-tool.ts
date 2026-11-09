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

const SPLIT_VERB = /(同时|并行|分别).{0,24}(调研|研究|检索|调查|搜索)|(research|investigat\w*).{0,40}(in parallel|simultaneously)|(in parallel|simultaneously).{0,40}(research|investigat\w*)/i
const MULTI_SUBJECT = /(两个|三个|多个|几[个项]|分别|各自|独立的?(模型|对象|方向|仓库)|、|\band\b|\b(two|three|both|multiple|several)\b)/i
const SWARM_SPLIT = /子代理.{0,20}(并行|同时|分别)|(并行|同时).{0,16}子代理/i
const NEGATED_PARALLEL_SPLIT = /(不要|别|无需|无须|不需要|禁止|避免|勿).{0,24}(同时|并行|分别)|(同时|并行|分别).{0,24}(不要|别|无需|无须|不需要|禁止|避免|勿)|\b(?:do not|don't|dont|avoid|without|not)\b.{0,40}\b(?:in parallel|simultaneously|parallel)\b|\b(?:in parallel|simultaneously|parallel)\b.{0,40}\b(?:do not|don't|dont|avoid|without|not)\b/i
const GENERIC_TRACK_NAME = /^(三个|两个|多个|独立|模型|对象|这些|那些|一下|the|and|or)$/i
const TRAILING_PLAN_CLAUSE = /^(然后|接着|最后|并且|并|且|再)/

/** User asked to split independent research tracks — not ordinary Q&A. */
export function hasExplicitParallelSplitIntent(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (NEGATED_PARALLEL_SPLIT.test(trimmed)) return false
  return SWARM_SPLIT.test(trimmed) || (SPLIT_VERB.test(trimmed) && MULTI_SUBJECT.test(trimmed))
}

/** Pull announced worker subjects from the user request or coordinator plan. */
export function extractParallelTrackNames(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const name = raw
      .replace(/^["'「『\[【]+|["'」』\]】]+$/g, '')
      .replace(/[。．.!?！？]+$/g, '')
      .trim()
    if (
      !name
      || name.length < 2
      || name.length > 60
      || GENERIC_TRACK_NAME.test(name)
      || TRAILING_PLAN_CLAUSE.test(name)
    ) return
    if (seen.has(name)) return
    seen.add(name)
    names.push(name)
  }

  for (const match of text.matchAll(/调研\s+([A-Za-z0-9][A-Za-z0-9._+\-]{1,40})/g)) {
    add(match[1]!)
  }

  const listed = text.match(/(?:同时|分别|并行)(?:调研|研究|检索|调查)[:：\s]+(.+)$/m)
  if (listed) {
    for (const part of listed[1]!.split(/[、，,;；。]|和|与|以及/)) add(part)
  }
  return names
}

export function readCurrentTurnSpawnContext(
  messages: Array<{ role: string; content?: unknown; hidden?: boolean; isQueued?: boolean }>,
): { userText: string; planningText: string } {
  const active = messages.filter(message => !message.isQueued)
  let lastUserIdx = -1
  for (let index = active.length - 1; index >= 0; index -= 1) {
    if (active[index]?.role === 'user') {
      lastUserIdx = index
      break
    }
  }
  const textOf = (message: { content?: unknown }) => (
    typeof message.content === 'string' ? message.content : ''
  )
  if (lastUserIdx < 0) return { userText: '', planningText: '' }
  if (active[lastUserIdx]!.hidden) return { userText: '', planningText: '' }
  return {
    userText: textOf(active[lastUserIdx]!),
    planningText: active
      .slice(lastUserIdx + 1)
      .filter(message => message.role === 'assistant' && !message.hidden)
      .map(textOf)
      .filter(Boolean)
      .join('\n'),
  }
}

/**
 * Recover a structured contract when the model omitted `qualification`.
 * Same-turn fan-out comes first. A sequential first worker may recover only
 * after the *user* asked for a parallel split; model planning text cannot
 * authorize the gate by itself.
 */
export function synthesizeAutomaticQualification(input: {
  candidates?: Array<{ name?: string; prompt?: string }>
  userText?: string
  planningText?: string
}): SpawnSessionQualification | undefined {
  const fromFanOut = synthesizeFanOutQualification(input.candidates ?? [])
  if (fromFanOut) return fromFanOut

  const userText = input.userText ?? ''
  if (!hasExplicitParallelSplitIntent(userText)) return undefined

  const named = extractParallelTrackNames(
    [input.planningText, userText].filter(Boolean).join('\n'),
  )
  if (named.length >= 2) {
    return synthesizeFanOutQualification(named.map(name => ({
      name,
      prompt: `Investigate ${name}`,
    })))
  }

  const spawn = (input.candidates ?? []).find(candidate => (
    candidate.name?.trim() || candidate.prompt?.trim()
  ))
  if (!spawn) return undefined
  return synthesizeFanOutQualification([
    spawn,
    {
      name: 'Remaining independent tracks',
      prompt: userText.trim(),
    },
  ])
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
