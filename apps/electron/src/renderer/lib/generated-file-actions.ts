import {
  resolveOpenableGeneratedPath,
  GeneratedFileUnavailableError,
  type SearchGeneratedFiles,
  type StatGeneratedPath,
} from './generated-file-path'

export type GeneratedArtifactAction = 'preview' | 'external' | 'reveal' | 'versions'

export async function openGeneratedFileAction(opts: {
  requestedPath: string
  action: GeneratedArtifactAction
  artifactId?: string
  versionId?: string
  baseDir?: string
  baseDirs?: string[]
  statPath?: StatGeneratedPath
  searchFiles: SearchGeneratedFiles
  openPreview: (path: string) => void | boolean | Promise<void | boolean>
  previewVersion?: (artifactId: string, versionId: string) => Promise<string>
  readArtifact?: (artifactId: string) => Promise<{ path: string; currentFileAvailable?: boolean }>
  manageArtifact?: (path: string, alternativePaths?: string[], versionId?: string) => void | Promise<void>
  openExternal?: (path: string) => void | boolean | Promise<void | boolean>
  reveal: (path: string) => void | Promise<void>
}): Promise<boolean> {
  if (opts.action === 'preview' && opts.versionId) {
    if (!opts.artifactId || !opts.previewVersion) throw new Error('Artifact version preview is unavailable')
    return (await opts.openPreview(await opts.previewVersion(opts.artifactId, opts.versionId))) !== false
  }
  if (opts.action === 'versions' && opts.versionId && opts.manageArtifact) {
    await opts.manageArtifact(opts.requestedPath, undefined, opts.versionId)
    return true
  }
  let requestedPath = opts.requestedPath
  if ((opts.action === 'external' || opts.action === 'reveal') && opts.artifactId && opts.readArtifact) {
    const record = await opts.readArtifact(opts.artifactId)
    if (record.currentFileAvailable === false) throw new Error('The original artifact file is no longer available')
    requestedPath = record.path
  }
  let picked
  try { picked = await resolveOpenableGeneratedPath({ ...opts, requestedPath }) }
  catch (error) {
    // Opening requires a live file; version recovery requires its stored identity.
    // Pass exact intended candidates to the registry, never a same-name search hit.
    if (opts.action !== 'versions' || !opts.manageArtifact || !(error instanceof GeneratedFileUnavailableError)
      || !error.candidates.length) throw error
    await opts.manageArtifact(error.candidates[0]!, error.candidates.slice(1))
    return true
  }
  const { path, type } = picked
  if (opts.action === 'versions') {
    if (type === 'directory' || !opts.manageArtifact) throw new Error('Version management is available for files only')
    await opts.manageArtifact(path)
  } else if (opts.action === 'external' || (opts.action === 'preview' && type === 'directory')) {
    if (!opts.openExternal) throw new Error('External file opening is unavailable')
    return (await opts.openExternal(path)) !== false
  } else if (opts.action === 'reveal') {
    await opts.reveal(path)
  } else {
    return (await opts.openPreview(path)) !== false
  }
  return true
}
