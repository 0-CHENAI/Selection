import { parseTaskDocument, serializeTaskYaml } from '@craft-agent/shared/tasks';

/** In-memory specs submitted by generate orchestrators via submit_task_definition. */
const pending = new Map<string, { generation: number; yaml: string }>();

export function validateSubmittedDefinition(spec: unknown):
  | { valid: true; yaml: string }
  | { valid: false; errors: string[] } {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)
    || (spec as Record<string, unknown>).schema_version !== 2) {
    return { valid: false, errors: ['schema_version: submit_task_definition requires the numeric value 2'] };
  }
  const raw = spec;
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

export function rememberSubmittedDefinition(sessionId: string, generation: number, yaml: string): void {
  pending.set(sessionId, { generation, yaml });
}

export function takeSubmittedDefinition(sessionId: string, generation: number): { yaml: string } | undefined {
  const value = pending.get(sessionId);
  if (!value || value.generation !== generation) return undefined;
  pending.delete(sessionId);
  return { yaml: value.yaml };
}

export function clearSubmittedDefinition(sessionId: string): void {
  pending.delete(sessionId);
}

/** Pull a YAML body out of an LLM reply (tolerate fences or surrounding prose). */
export function extractYamlFromModelText(text: string): string {
  const fenced = text.match(/```(?:ya?ml)?\s*\n?([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Resolve one generator turn.
 *
 * New v2 definitions have exactly one trusted ingress: submit_task_definition.
 * Free-text YAML remains readable only for legacy/v1 generator transcripts, so
 * historical sessions can still be repaired without making pasted v2 YAML a
 * second, less-strict authoring path.
 */
export function resolveGeneratedYaml(
  sessionId: string,
  generation: number,
  finalText: string,
  options: { allowLegacyFallback?: boolean } = {},
): string {
  const submitted = takeSubmittedDefinition(sessionId, generation);
  if (submitted) return submitted.yaml;

  if (!options.allowLegacyFallback) {
    throw new Error('New task definitions must be submitted with submit_task_definition in the current generation.');
  }
  const fallback = extractYamlFromModelText(finalText);
  if (parseTaskDocument(fallback).sourceVersion === 2) {
    throw new Error(
      'New schema_version: 2 task definitions must be submitted with submit_task_definition; free-text v2 YAML is not accepted.',
    );
  }
  return fallback;
}
