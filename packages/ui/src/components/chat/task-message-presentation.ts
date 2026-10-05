import type { Message } from '@craft-agent/core'

/** Recognize only historical host protocols in an owned task session, never arbitrary user JSON. */
export function withTaskMessagePresentation(message: Message, context: { taskSlug?: string; nodeId?: string; title?: string }): Message {
  if (!context.taskSlug || message.role !== 'user' || message.hidden || message.taskContext) return message
  const text = message.content
  let kind: NonNullable<Message['taskContext']>['kind'] | undefined
  if (context.nodeId && (
    /^(?:Logical actor [^\n]+\n\n)?Canonical execution identity: slug=/.test(text)
      && text.includes('Original user goal:') && text.includes('Acceptance criteria:')
    || /^(?:\[skill:[^\]]+\]\s*)*Research role: \w+\. Frozen research criteria and records/.test(text)
  )) kind = 'assignment'
  else if (/^The task "[^\n]+" has finished running\.\nTask slug:/.test(text)
    && text.includes('Node outputs:') && text.includes('Call submit_task_verdict')) kind = 'verification'
  else if (/^Conductor checkpoint \([\w-]+\)\./.test(text)
    && /Call submit_orchestration_(?:decision|patch)/.test(text)) kind = 'coordination'
  if (!kind) return message
  const goal = kind === 'assignment' ? text.match(/^Original user goal: ([^\n]+)/m)?.[1] : undefined
  return { ...message, taskContext: {
    kind,
    ...(kind === 'assignment' && context.title && context.title !== context.nodeId ? { title: context.title } : {}),
    ...(goal ? { description: goal } : {}),
  } }
}
