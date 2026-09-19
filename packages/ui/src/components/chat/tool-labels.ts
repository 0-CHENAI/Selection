import i18n from 'i18next'

const labels: Record<string, [string, string]> = {
  WebSearch: ['webSearch', 'Web Search'],
  WebFetch: ['webFetch', 'Fetch URL'],
  Read: ['read', 'Read'],
  Write: ['write', 'Write'],
  Edit: ['edit', 'Edit'],
  Bash: ['bash', 'Terminal'],
  Grep: ['grep', 'Search'],
  Glob: ['glob', 'Find Files'],
  Task: ['agent', 'Agent'],
  Agent: ['agent', 'Agent'],
  TodoWrite: ['todoWrite', 'Update Todos'],
  NotebookEdit: ['notebookEdit', 'Edit Notebook'],
  KillShell: ['killShell', 'Kill Shell'],
  TaskOutput: ['taskOutput', 'Task Output'],
  SearchCraftAgents: ['searchDocumentation', 'Search Documentation'],
  submit_answer: ['submitAnswer', 'Sending the final reply'],
}

/** Resolve fixed native labels at render time, including stored English metadata. */
export function localizedToolLabel(toolName: string | undefined): string | undefined {
  const label = toolName ? labels[toolName] : undefined
  return label ? i18n.t(`tools.${label[0]}`, { defaultValue: label[1] }) : undefined
}

/**
 * submit_answer delivers the final reply itself — its generated intent
 * ("submit the complete answer") only restates that, so rows and previews
 * show the localized label alone.
 */
export function isSubmitAnswerTool(toolName: string | undefined): boolean {
  if (!toolName) return false
  const normalized = toolName.replace(/^(mcp__session__|session__)/, '').toLowerCase()
  return normalized === 'submit_answer'
}
