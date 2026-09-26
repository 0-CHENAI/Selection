import {
  resolveOpenableGeneratedPath,
  type SearchGeneratedFiles,
  type StatGeneratedPath,
} from './generated-file-path'

export type GeneratedArtifactAction = 'preview' | 'external' | 'reveal'

export async function openGeneratedFileAction(opts: {
  requestedPath: string
  action: GeneratedArtifactAction
  baseDir?: string
  baseDirs?: string[]
  statPath?: StatGeneratedPath
  searchFiles: SearchGeneratedFiles
  openPreview: (path: string) => void | Promise<void>
  openExternal?: (path: string) => void | Promise<void>
  reveal: (path: string) => void | Promise<void>
}): Promise<void> {
  const { path, type } = await resolveOpenableGeneratedPath(opts)
  if (opts.action === 'external' || (opts.action === 'preview' && type === 'directory')) {
    if (!opts.openExternal) throw new Error('External file opening is unavailable')
    await opts.openExternal(path)
  } else if (opts.action === 'reveal') {
    await opts.reveal(path)
  } else {
    await opts.openPreview(path)
  }
}
