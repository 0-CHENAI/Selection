import { isArtifactCardPath } from '@craft-agent/shared/utils/artifact-links'

export type ArtifactChange = 'created' | 'modified' | 'deleted' | 'restored'

export interface ResponseArtifact {
  path: string
  name: string
  extension: string
  change?: ArtifactChange
}

export function artifactPathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

/** Show recorded, openable changes in the supported document formats. */
export function extractDeliveredResponseArtifacts(
  versions?: readonly { path: string; ordinal?: number; change?: ArtifactChange }[],
): ResponseArtifact[] {
  if (!versions?.length) return []
  const artifacts: ResponseArtifact[] = []
  const seen = new Set<string>()
  for (const version of versions) {
    if (!isArtifactCardPath(version.path) || version.change === 'deleted') continue
    const key = artifactPathKey(version.path)
    if (seen.has(key)) continue
    seen.add(key)
    const name = version.path.replace(/\\/g, '/').split('/').pop() || version.path
    artifacts.push({
      path: version.path,
      name,
      extension: name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
      change: version.change ?? (version.ordinal === 1 ? 'created' : 'modified'),
    })
  }
  return artifacts
}
