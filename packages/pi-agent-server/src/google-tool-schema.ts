import type { AgentSession } from '@earendil-works/pi-coding-agent'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

export function isGoogleGenerativeApi(api?: string): boolean {
  return api === 'google-generative-ai' || api === 'google-vertex' || api === 'google-gemini-cli'
}

function isObjectBranch(value: unknown): value is JsonRecord {
  const rec = asRecord(value)
  if (!rec) return false
  return rec.type === 'object' || asRecord(rec.properties) !== undefined
}

function extractStringEnum(prop: JsonRecord): string[] | null {
  if (prop.type !== undefined && prop.type !== 'string') return null
  if (typeof prop.const === 'string') return [prop.const]
  if (Array.isArray(prop.enum) && prop.enum.length > 0 && prop.enum.every((v): v is string => typeof v === 'string')) {
    return prop.enum
  }
  return null
}

function mergeDescriptions(schemas: readonly JsonRecord[]): string | undefined {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const schema of schemas) {
    if (typeof schema.description !== 'string') continue
    const trimmed = schema.description.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    parts.push(trimmed)
  }
  return parts.length > 0 ? parts.join(' / ') : undefined
}

function mergePropertySchemas(occurrences: readonly JsonRecord[]): JsonRecord {
  if (occurrences.length === 1) return { ...occurrences[0] }

  const description = mergeDescriptions(occurrences)

  const stringEnums = occurrences.map(extractStringEnum)
  if (stringEnums.every((vals): vals is string[] => vals !== null)) {
    const mergedEnum: string[] = []
    const seen = new Set<string>()
    for (const vals of stringEnums) {
      for (const value of vals) {
        if (seen.has(value)) continue
        seen.add(value)
        mergedEnum.push(value)
      }
    }
    return {
      type: 'string',
      enum: mergedEnum,
      ...(description ? { description } : {}),
    }
  }

  const types = new Set(occurrences.map((item) => item.type))
  if (types.size === 1) {
    const sharedType = occurrences[0]!.type
    if (sharedType === 'string' || sharedType === 'number' || sharedType === 'integer' || sharedType === 'boolean') {
      const merged: JsonRecord = { type: sharedType }
      if (description) merged.description = description

      const minLengths = occurrences.map((o) => o.minLength).filter((v): v is number => typeof v === 'number')
      if (minLengths.length === occurrences.length) merged.minLength = Math.min(...minLengths)
      const maxLengths = occurrences.map((o) => o.maxLength).filter((v): v is number => typeof v === 'number')
      if (maxLengths.length === occurrences.length) merged.maxLength = Math.max(...maxLengths)
      const mins = occurrences.map((o) => o.minimum).filter((v): v is number => typeof v === 'number')
      if (mins.length === occurrences.length) merged.minimum = Math.min(...mins)
      const maxs = occurrences.map((o) => o.maximum).filter((v): v is number => typeof v === 'number')
      if (maxs.length === occurrences.length) merged.maximum = Math.max(...maxs)

      const patterns = new Set(occurrences.map((o) => (typeof o.pattern === 'string' ? o.pattern : null)))
      if (patterns.size === 1) {
        const onlyPattern = [...patterns][0]
        if (onlyPattern) merged.pattern = onlyPattern
      }

      const formats = new Set(occurrences.map((o) => (typeof o.format === 'string' ? o.format : null)))
      if (formats.size === 1) {
        const onlyFormat = [...formats][0]
        if (onlyFormat) merged.format = onlyFormat
      }

      return merged
    }
  }

  const uniqueVariants: JsonRecord[] = []
  const seenJson = new Set<string>()
  for (const occ of occurrences) {
    const serialized = JSON.stringify(occ)
    if (seenJson.has(serialized)) continue
    seenJson.add(serialized)
    uniqueVariants.push({ ...occ })
  }
  if (uniqueVariants.length === 1) {
    return { ...uniqueVariants[0], ...(description ? { description } : {}) }
  }
  return {
    anyOf: uniqueVariants,
    ...(description ? { description } : {}),
  }
}

function collectObjectUnionBranches(schema: JsonRecord): JsonRecord[] | null {
  const union = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null
  if (!union || union.length === 0) return null

  const collected: JsonRecord[] = []
  for (const item of union) {
    const rec = asRecord(item)
    if (!rec) return null
    const existingProps = asRecord(rec.properties)
    const hasNonEmptyProps = existingProps !== undefined && Object.keys(existingProps).length > 0
    if (!hasNonEmptyProps && (Array.isArray(rec.anyOf) || Array.isArray(rec.oneOf))) {
      const nested = collectObjectUnionBranches(rec)
      if (!nested) return null
      collected.push(...nested)
      continue
    }
    if (!isObjectBranch(rec)) return null
    collected.push(rec)
  }
  return collected.length > 0 ? collected : null
}

/**
 * Gemini 3/4 rejects function declarations whose root schema is a bare
 * `anyOf` / `oneOf` object union (e.g. Zod `z.discriminatedUnion` tools like
 * `office_business`) with HTTP 400 INVALID_ARGUMENT when Pi enables
 * `FunctionCallingConfigMode.VALIDATED`.
 *
 * Flattening root object unions into a single object schema with merged
 * properties (and the intersection of branch `required` keys) satisfies
 * Gemini's constrained-decoding validator while keeping full per-branch Zod
 * validation intact in the tool handler.
 */
export function flattenGoogleRootUnionSchema(schema: JsonRecord): JsonRecord {
  const existingProps = asRecord(schema.properties)
  if (existingProps !== undefined && Object.keys(existingProps).length > 0) return schema

  const union = collectObjectUnionBranches(schema)
  if (!union) return schema

  const propBuckets = new Map<string, JsonRecord[]>()
  let commonRequired: string[] | null = null

  for (const branch of union) {
    const branchRequired = new Set<string>(
      Array.isArray(branch.required)
        ? branch.required.filter((key): key is string => typeof key === 'string')
        : [],
    )
    commonRequired = commonRequired === null
      ? [...branchRequired]
      : commonRequired.filter((key) => branchRequired.has(key))

    const branchProps = asRecord(branch.properties) ?? {}
    for (const [key, rawProp] of Object.entries(branchProps)) {
      const prop = asRecord(rawProp)
      if (!prop) continue
      const bucket = propBuckets.get(key)
      if (bucket) bucket.push(prop)
      else propBuckets.set(key, [prop])
    }
  }

  const properties: Record<string, JsonRecord> = {}
  for (const [key, occurrences] of propBuckets.entries()) {
    properties[key] = mergePropertySchemas(occurrences)
  }

  const required = commonRequired ? [...commonRequired].filter((key) => key in properties) : []

  return {
    type: 'object',
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

/**
 * Sanitize outgoing Google GenerateContent payloads in-memory without mutating
 * the caller's tool definitions. Returns the original reference when no tool
 * declarations need flattening.
 */
export function sanitizeGoogleGenerateContentPayload<T>(payload: T): T {
  const root = asRecord(payload)
  const config = asRecord(root?.config)
  const tools = Array.isArray(config?.tools) ? config.tools : null
  if (!root || !config || !tools) return payload

  let anyChanged = false
  const nextTools = tools.map((toolEntry) => {
    const entry = asRecord(toolEntry)
    const decls = Array.isArray(entry?.functionDeclarations) ? entry.functionDeclarations : null
    if (!entry || !decls) return toolEntry

    let entryChanged = false
    const nextDecls = decls.map((rawDecl) => {
      const decl = asRecord(rawDecl)
      if (!decl) return rawDecl

      let declChanged = false
      let nextDecl: JsonRecord | null = null

      const jsonSchema = asRecord(decl.parametersJsonSchema)
      if (jsonSchema) {
        const flattened = flattenGoogleRootUnionSchema(jsonSchema)
        if (flattened !== jsonSchema) {
          declChanged = true
          nextDecl = { ...decl, parametersJsonSchema: flattened }
        }
      }

      const legacyParams = asRecord(decl.parameters)
      if (legacyParams) {
        const flattened = flattenGoogleRootUnionSchema(legacyParams)
        if (flattened !== legacyParams) {
          declChanged = true
          nextDecl = { ...(nextDecl ?? decl), parameters: flattened }
        }
      }

      if (declChanged) {
        entryChanged = true
        return nextDecl
      }
      return rawDecl
    })

    if (!entryChanged) return toolEntry
    anyChanged = true
    return { ...entry, functionDeclarations: nextDecls }
  })

  if (!anyChanged) return payload
  return {
    ...root,
    config: {
      ...config,
      tools: nextTools,
    },
  } as T
}

const installedSessions = new WeakSet<AgentSession>()

/**
 * Wrap the session stream function so Google Generative AI payloads flatten
 * top-level `anyOf`/`oneOf` tool schemas before sending to Gemini.
 */
export function installGoogleToolSchemaSanitizer(session: AgentSession): void {
  if (installedSessions.has(session)) return
  installedSessions.add(session)
  const stream = session.agent.streamFunction
  session.agent.streamFunction = (model, context, options) => {
    if (!isGoogleGenerativeApi(model.api)) return stream(model, context, options)
    return stream(model, context, {
      ...options,
      onPayload: async (payload, requestModel) => {
        const body = await options?.onPayload?.(payload, requestModel) ?? payload
        return sanitizeGoogleGenerateContentPayload(body)
      },
    })
  }
}
