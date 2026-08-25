export interface NamedParam {
  name: string;
  sensitive?: boolean;
}

export function sensitiveParamNames(params: readonly NamedParam[] | undefined): string[] {
  return (params ?? []).filter((p) => p.sensitive).map((p) => p.name);
}

export const SENSITIVE_REDACTION = '***';

export function redactSensitive(
  values: Record<string, unknown> | undefined,
  names: readonly string[],
): Record<string, unknown> {
  const out = { ...(values ?? {}) };
  for (const name of names) {
    if (name in out) out[name] = SENSITIVE_REDACTION;
  }
  return out;
}

export function missingSensitive(values: Record<string, unknown> | undefined, names: readonly string[]): string[] {
  return names.filter((name) => {
    const v = values?.[name];
    return v === undefined || v === '' || v === SENSITIVE_REDACTION;
  });
}
