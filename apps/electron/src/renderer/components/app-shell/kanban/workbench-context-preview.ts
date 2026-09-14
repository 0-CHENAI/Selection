import type { CompiledThoughtContext } from '@craft-agent/shared/thought-workbench/types'

export function workbenchContextPreview(context: CompiledThoughtContext): string {
  if (context.agentInput) {
    const snapshot = context.agentInput
    // Binary images are represented by the original material digest below the
    // preview, not megabytes of base64 text. Never omit model-facing text/tools.
    const messages = snapshot.context.messages.map(message => ({ ...message, content: typeof message.content === 'string'
      ? message.content : message.content.map(block => block.type === 'image'
        ? { type: block.type, mimeType: block.mimeType, base64Length: block.data.length } : block) }))
    return `[model]\n${JSON.stringify(snapshot.model, null, 2)}\n\n[system]\n${snapshot.context.systemPrompt ?? ''}\n\n[messages]\n${JSON.stringify(messages, null, 2)}\n\n[tools]\n${JSON.stringify(snapshot.context.tools ?? [], null, 2)}\n\n[sha256]\n${snapshot.hash}`
  }
  return context.mode === 'question' ? `[system]\n${context.systemPrompt}\n\n${context.messages.filter(message => message.role !== 'system').map(message => `[${message.role}]\n${message.content}`).join('\n\n')}` : context.prompt
}
