import { parseTaskDocument, serializeTaskYaml } from '@craft-agent/shared/tasks';

/** In-memory specs submitted by generate orchestrators via submit_task_definition. */
const pending = new Map<string, { yaml: string }>();

export function validateSubmittedDefinition(spec: unknown):
  | { valid: true; yaml: string }
  | { valid: false; errors: string[] } {
  const raw = spec && typeof spec === 'object' && !Array.isArray(spec)
    ? { ...(spec as Record<string, unknown>), schema_version: 2 }
    : spec;
  // JSON is a YAML subset and preserves every input key for the strict v2
  // unknown-field pass. Parsing with the permissive Zod schema first would
  // strip typos such as `token_buget` before they can be rejected.
  const parsed = parseTaskDocument(JSON.stringify(raw));
  if (!parsed.valid || !parsed.spec) {
    return {
      valid: false,
      errors: parsed.errors.map((issue) => `${issue.path}: ${issue.message}`),
    };
  }
  return { valid: true, yaml: serializeTaskYaml(parsed.spec) };
}

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
