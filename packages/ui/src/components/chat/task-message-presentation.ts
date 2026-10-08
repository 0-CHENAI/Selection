import type { Message } from '@craft-agent/core'

function protocolRecord(text: string, label: RegExp): Record<string, unknown> | undefined {
  const json = text.match(label)?.[1]
  if (!json) return undefined
  try {
    const value: unknown = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch { return undefined }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []
}

/** Strip known host envelopes from legacy assignments, never infer instructions from their global goal. */
function assignmentInstruction(text: string): string | undefined {
  let body = text.replace(/^Logical actor [^\n]+\r?\n\r?\n/, '')
    .replace(/^Canonical execution identity:[\s\S]*?\nAcceptance criteria:[^\n]*\r?\n\r?\n/, '')
    .replace(/^(?:Apply these skills: \[skill:[^\n]+\]\r?\n\r?\n|(?:\[skill:[^\]]+\]\s*)+)/, '')
    .replace(/^Research role: [^\n]+\r?\nSubmit values\.research[^\n]*\r?\n/, '')
  body = body.replace(/^(?:(?:Research business state and delivery requirements|User constraints for every node|Confirmed plan decisions|Delegated task facts and separate outputs|Structured help history \(responses do not grant permissions\)): [^\n]*\r?\n)+\r?\n/, '')
  if (body === text) return undefined
  body = body.replace(/^(?:Research output:|Previous attempt failed:|The previous (?:result was rejected|verification failed)|completed without submit_task_)[\s\S]*?\r?\n\r?\n/, '')
  if (/^(?:Canonical execution identity:|Research role:|Original user goal:|Acceptance criteria:)/.test(body)) return undefined
  return body.split(/\r?\n\r?\n(?:Confirmed prior actor task results|Write candidate outputs only inside|Judge the assigned inspection contract)/, 1)[0]?.trim() || undefined
}

/** A brief excerpt of the actual assignment; omit wire-format clauses rather than paraphrasing their meaning. */
export function taskAssignmentSummary(context: Message['taskContext']): string | undefined {
  if (context?.kind !== 'assignment' || !context.instruction) return undefined
  const text = context.instruction.replace(/\[skill:[^\]]+\]/g, '').replace(/```[\s\S]*?```/g, '').trim()
  const sentences = Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text), ({ segment }) => {
    const clauses = segment.split(/[；;\n]|[,，](?!\d)/)
      .map(clause => clause.split(/\$\{|```|[\[{]/, 1)[0]?.trim() ?? '')
      .filter(clause => clause && !/(?:\b(?:values\.research|submit_[\w]+|claimRef|sourceVersion|dimensionIds|evidenceIds|followupTaskRef|depends_on|locator|excerpt|changeEvidence)\b|\b[\w/]+\s*=)/.test(clause))
    const prose = clauses.join('，').replace(/\bRead\s+(?=[\p{Script=Han}])/gu, '读取')
      .replace(/([\p{Script=Han}])\s+读取/gu, '$1读取').replace(/^text(?=说明)/, '')
    const punctuation = segment.trim().match(/[。！？.!?]$/)?.[0]
    return prose && punctuation && !/[。！？.!?]$/.test(prose) ? prose + punctuation : prose
  }).filter(Boolean).slice(0, 2)
  return sentences.join(' ') || context.title
}

/** Project only descriptive fields, never hashes, paths, claim IDs or execution commands. */
function researchBriefing(text: string) {
  const research = protocolRecord(text, /^Research role: \w+\. Frozen research criteria and records[^\n]*?: (\{[^\n]*\})\r?$/m)
  if (!research) return undefined
  const line = research.line as { question?: unknown; premises?: unknown } | undefined
  const pick = (value: unknown, field: string) => Array.isArray(value)
    ? strings(value.map(item => item && typeof item === 'object' ? item[field] : undefined)) : []
  const requirements = pick(research.dimensions, 'requirement')
  const sources = pick(research.sources, 'ref')
  const constraints = text.match(/^User constraints for every node: (\[[^\n]*\])\r?$/m)?.[1]
  let limits = strings(line?.premises)
  if (constraints) {
    try { limits = [...new Set([...limits, ...strings(JSON.parse(constraints))])] } catch { /* Old incomplete records remain readable. */ }
  }
  return {
    goal: typeof line?.question === 'string' ? line.question : undefined,
    briefing: requirements.length || sources.length || limits.length ? { requirements, sources, limits } : undefined,
  }
}

/** Recognize only historical host protocols in an owned task session, never arbitrary user JSON. */
export function withTaskMessagePresentation(message: Message, context: { taskSlug?: string; nodeId?: string; title?: string }): Message {
  if (!context.taskSlug || message.role !== 'user' || message.hidden && context.nodeId) return message
  if (message.taskContext && (message.taskContext.kind !== 'assignment' || message.taskContext.briefing && message.taskContext.instruction)) return message
  // TaskRunner's historical skills preamble precedes both canonical and research assignments.
  const text = message.content.replace(/^Apply these skills: \[skill:[^\n]+\]\r?\n\r?\n/, '')
    .replace(/^(?:\[skill:[^\]]+\]\s*)+/, '')
  let kind: NonNullable<Message['taskContext']>['kind'] | undefined
  if (context.nodeId && (
    /^(?:Logical actor [^\n]+\n\n)?Canonical execution identity: slug=/.test(text)
      && text.includes('Original user goal:') && text.includes('Acceptance criteria:')
    || /^Research role: \w+\. Frozen research criteria and records/.test(text)
  )) kind = 'assignment'
  else if (/^The task "[^\n]+" has finished running\.\nTask slug:/.test(text)
    && text.includes('Node outputs:') && text.includes('Call submit_task_verdict')) kind = 'verification'
  else if (/^Conductor checkpoint \([\w-]+\)\./.test(text)
    && /Call submit_orchestration_(?:decision|patch)/.test(text)) kind = 'coordination'
  if (!kind) return message
  const research = kind === 'assignment' ? researchBriefing(text) : undefined
  const instruction = kind === 'assignment' ? assignmentInstruction(text) : undefined
  if (message.taskContext && !research?.briefing && !instruction) return message
  const goal = kind === 'assignment' ? text.match(/^Original user goal: ([^\n]+)/m)?.[1] ?? research?.goal : undefined
  return { ...message, taskContext: {
    kind,
    ...(kind === 'assignment' && context.title && context.title !== context.nodeId ? { title: context.title } : {}),
    ...(goal ? { description: goal } : {}),
    ...(instruction ? { instruction } : {}),
    ...message.taskContext,
    ...(research?.briefing ? { briefing: research.briefing } : {}),
  } }
}
