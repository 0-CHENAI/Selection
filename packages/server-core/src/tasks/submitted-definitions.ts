/** In-memory specs submitted by generate orchestrators via submit_task_definition. */
const pending = new Map<string, { yaml: string }>();

export function rememberSubmittedDefinition(sessionId: string, yaml: string): void {
  pending.set(sessionId, { yaml });
}

export function takeSubmittedDefinition(sessionId: string): { yaml: string } | undefined {
  const value = pending.get(sessionId);
  if (value) pending.delete(sessionId);
  return value;
}

/** Pull a YAML body out of an LLM reply (tolerate fences or surrounding prose). */
export function extractYamlFromModelText(text: string): string {
  const fenced = text.match(/```(?:ya?ml)?\s*\n?([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Prefer a structured submit_task_definition payload over free-text YAML. */
export function resolveGeneratedYaml(sessionId: string, finalText: string): string {
  return takeSubmittedDefinition(sessionId)?.yaml ?? extractYamlFromModelText(finalText);
}
