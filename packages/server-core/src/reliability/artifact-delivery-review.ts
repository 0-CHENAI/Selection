import { openSync, readSync, closeSync, statSync } from 'node:fs'
import type { LLMQueryRequest, LLMQueryResult } from '@craft-agent/shared/agent/llm-tool'

export interface ArtifactReviewInput {
  request: string
  answer: string
  candidates: readonly string[]
  proposed: readonly string[]
}

function excerpt(path: string): string | undefined {
  const buffer = Buffer.alloc(512)
  const handle = openSync(path, 'r')
  try {
    const read = readSync(handle, buffer, 0, buffer.length, 0)
    const bytes = buffer.subarray(0, read)
    return bytes.includes(0) ? undefined : bytes.toString('utf8').replace(/\s+/g, ' ').trim()
  } finally { closeSync(handle) }
}

/** A separate, structured judgement over one slice of the host's change ledger. */
async function reviewBatch(
  input: ArtifactReviewInput,
  query: (request: LLMQueryRequest) => Promise<LLMQueryResult>,
): Promise<string[]> {
  if (!input.candidates.length) return []
  const files = input.candidates.map((path, index) => ({
    id: index + 1, path, bytes: statSync(path).size, excerpt: excerpt(path),
  }))
  const result = await query({
    systemPrompt: 'You review files created or changed during one agent turn. Classify EVERY candidate as primary or supporting. Primary means a finished file the user should open as a result. Source data, citations, helper scripts, drafts, logs and tests are supporting. Judge from the request, final answer and file evidence; proposed paths are suggestions, not authority. Return one decision for each candidate ID in display order, with a brief reason. Do not silently omit any candidate.',
    prompt: JSON.stringify({ request: input.request, answer: input.answer, proposed: input.proposed, files }),
    temperature: 0,
    outputSchema: { type: 'object', properties: { decisions: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, role: { type: 'string', enum: ['primary', 'supporting'] }, reason: { type: 'string' },
    }, required: ['id', 'role', 'reason'], additionalProperties: false } } }, required: ['decisions'], additionalProperties: false },
  })
  const start = result.text.indexOf('{'), end = result.text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Artifact review returned no structured decision')
  const parsed = JSON.parse(result.text.slice(start, end + 1)) as { decisions?: Array<{ id: number; role: string; reason: string }> }
  if (!Array.isArray(parsed.decisions) || parsed.decisions.length !== files.length
    || new Set(parsed.decisions.map(decision => decision.id)).size !== files.length
    || parsed.decisions.some(decision => !Number.isInteger(decision.id) || decision.id < 1 || decision.id > files.length
      || !['primary', 'supporting'].includes(decision.role) || !decision.reason?.trim())) {
    throw new Error('Artifact review did not classify every candidate')
  }
  return parsed.decisions.filter(decision => decision.role === 'primary').map(decision => files[decision.id - 1]!.path)
}

/** Review every changed file without a fixed file or call limit. */
export async function reviewArtifactDelivery(
  input: ArtifactReviewInput,
  query: (request: LLMQueryRequest) => Promise<LLMQueryResult>,
): Promise<string[]> {
  const selected: string[] = []
  for (let start = 0; start < input.candidates.length; start += 40) {
    selected.push(...await reviewBatch({ ...input, candidates: input.candidates.slice(start, start + 40) }, query))
  }
  // One global pass resolves competition between files selected in separate slices.
  return input.candidates.length > 40 && selected.length > 1 && selected.length <= 40
    ? reviewBatch({ ...input, candidates: selected }, query) : selected
}
