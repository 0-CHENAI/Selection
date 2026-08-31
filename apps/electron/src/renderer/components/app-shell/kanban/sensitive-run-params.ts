export interface TaskParamLike {
  name?: unknown
  sensitive?: unknown
}

export function sensitiveRunParamNames(spec: { params?: unknown } | undefined): string[] {
  if (!Array.isArray(spec?.params)) return []
  return spec.params
    .filter((param): param is TaskParamLike => Boolean(param) && typeof param === 'object')
    .filter((param) => param.sensitive === true && typeof param.name === 'string' && param.name.trim().length > 0)
    .map((param) => (param.name as string).trim())
}

export function buildSensitiveRunParams(
  names: readonly string[],
  drafts: Readonly<Record<string, string>>,
): { params?: Record<string, string>; missing: string[] } {
  const missing = names.filter((name) => !drafts[name]?.trim())
  if (missing.length > 0) return { missing }
  return {
    missing: [],
    params: Object.fromEntries(names.map((name) => [name, drafts[name]])),
  }
}
