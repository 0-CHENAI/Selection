export interface OfficeActivitySummary {
  backend?: string
  file?: string
  durationMs?: number
  warningCount: number
  deliveryReady?: boolean
  previewReady: boolean
}

/** Parse the structured Office envelope while ignoring a following preview block. */
export function parseOfficeActivitySummary(
  toolName: string | undefined,
  content: string | undefined,
): OfficeActivitySummary | null {
  const canonicalName = toolName?.replace(/^mcp__session__/, '')
  if (!canonicalName?.startsWith('office_document_') || !content) return null
  const jsonText = content.replace(/^\[ERROR\]\s*/, '').split(/\n\n```/, 1)[0]?.trim()
  if (!jsonText) return null
  try {
    const envelope = JSON.parse(jsonText) as Record<string, unknown>
    const warnings = Array.isArray(envelope.warnings) ? envelope.warnings : []
    const artifacts = Array.isArray(envelope.artifacts) ? envelope.artifacts : []
    const documentPath = typeof envelope.documentPath === 'string' ? envelope.documentPath : undefined
    return {
      backend: typeof envelope.backend === 'string' ? envelope.backend : undefined,
      file: documentPath ? documentPath.replace(/\\/g, '/').split('/').pop() : undefined,
      durationMs: typeof envelope.durationMs === 'number' ? envelope.durationMs : undefined,
      warningCount: warnings.length,
      deliveryReady: typeof envelope.deliveryReady === 'boolean' ? envelope.deliveryReady : undefined,
      previewReady: artifacts.some(artifact => (
        typeof artifact === 'object'
        && artifact !== null
        && (artifact as { kind?: unknown }).kind === 'image'
      )),
    }
  } catch {
    return null
  }
}
