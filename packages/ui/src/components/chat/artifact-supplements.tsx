import { createContext, useContext, type ReactNode } from 'react'
import { artifactPathKey, type ResponseArtifact } from './response-artifacts'

/** Extra presentation for one delivered file, or a row that exists before the file is recorded. */
export interface ArtifactSupplement {
  path: string
  name: string
  extension: string
  /** Hosts that may show this row before `path` is in their artifact list. */
  pendingAnchors?: readonly string[]
  /** Hosts allowed to restyle an artifact they already list. Absent means every host. */
  applyAnchors?: readonly string[]
  meta?: ReactNode
  /** 0–1. Absent hides the 2px bar. */
  progress?: number
  onActivate?: () => void
  testId?: string
  /**
   * Replaces the row-end control.
   * A function receives the standard open-with items so they can move into another menu.
   */
  trailing?: ReactNode | ((standardItems: ReactNode) => ReactNode)
}

export interface MergedArtifactRow {
  artifact: ResponseArtifact
  supplement?: ArtifactSupplement
  synthetic: boolean
}

const EMPTY_SUPPLEMENTS: readonly ArtifactSupplement[] = []

function intersects(needles: readonly string[] | undefined, anchors: ReadonlySet<string>): boolean {
  return !!needles?.some(anchor => anchors.has(anchor))
}

/**
 * Fold live file rows into the deliverable list.
 * Pending mode keeps only supplemented rows, so a file can appear before the turn settles.
 * A listed file is not also injected.
 */
export function mergeArtifactSupplements(
  artifacts: readonly ResponseArtifact[],
  supplements: readonly ArtifactSupplement[],
  anchors: readonly string[],
  mode: 'settled' | 'pending',
): MergedArtifactRow[] {
  const anchorSet = new Set(anchors)
  const byKey = new Map<string, ArtifactSupplement>()
  for (const supplement of supplements) {
    if (supplement.applyAnchors?.length && !intersects(supplement.applyAnchors, anchorSet)) continue
    byKey.set(artifactPathKey(supplement.path), supplement)
  }
  const used = new Set<string>()
  const source = mode === 'pending'
    ? artifacts.filter(artifact => byKey.has(artifactPathKey(artifact.path)))
    : artifacts
  const rows: MergedArtifactRow[] = source.map(artifact => {
    const supplement = byKey.get(artifactPathKey(artifact.path))
    if (supplement) used.add(artifactPathKey(supplement.path))
    return { artifact, ...(supplement ? { supplement } : {}), synthetic: false }
  })
  for (const supplement of supplements) {
    const key = artifactPathKey(supplement.path)
    if (used.has(key) || byKey.get(key) !== supplement) continue
    if (!intersects(supplement.pendingAnchors, anchorSet)) continue
    used.add(key)
    rows.unshift({
      artifact: { path: supplement.path, name: supplement.name, extension: supplement.extension },
      supplement,
      synthetic: true,
    })
  }
  const pinned = rows.filter(row => row.supplement)
  const rest = rows.filter(row => !row.supplement)
  return pinned.length === 0 ? rows : [...pinned, ...rest]
}

const ArtifactSupplementContext = createContext<readonly ArtifactSupplement[]>(EMPTY_SUPPLEMENTS)

export function ArtifactSupplementsProvider({ supplements, children }: {
  supplements: readonly ArtifactSupplement[]
  children: ReactNode
}) {
  return <ArtifactSupplementContext.Provider value={supplements}>{children}</ArtifactSupplementContext.Provider>
}

export function useArtifactSupplements(): readonly ArtifactSupplement[] {
  return useContext(ArtifactSupplementContext)
}
