import { describe, expect, test } from 'bun:test'
import { openGeneratedFileAction, type GeneratedArtifactAction } from '../generated-file-actions'

describe('generated artifact actions', () => {
  const fileName = 'enterprise-data-platform-flow.html'
  const realPath = `D:\\成果\\${fileName}`
  const wrongPath = `C:\\成果\\${fileName}`

  for (const action of ['preview', 'external', 'reveal'] as GeneratedArtifactAction[]) {
    test(`${action} receives the validated D: path`, async () => {
      const calls: string[] = []
      await openGeneratedFileAction({
        requestedPath: fileName,
        action,
        baseDir: 'D:\\成果',
        searchFiles: async () => [
          { type: 'file', name: fileName, path: wrongPath },
          { type: 'file', name: fileName, path: realPath },
        ],
        openPreview: (path) => { calls.push(`preview:${path}`) },
        openExternal: (path) => { calls.push(`external:${path}`) },
        reveal: (path) => { calls.push(`reveal:${path}`) },
      })
      expect(calls).toEqual([`${action}:${realPath}`])
    })
  }

  test('a missing D: target never calls an opener with a C: duplicate', async () => {
    const calls: string[] = []
    await expect(openGeneratedFileAction({
      requestedPath: realPath,
      action: 'external',
      baseDir: 'C:\\成果',
      searchFiles: async () => [{ type: 'file', name: fileName, path: wrongPath }],
      openPreview: (path) => { calls.push(path) },
      openExternal: (path) => { calls.push(path) },
      reveal: (path) => { calls.push(path) },
    })).rejects.toThrow('File not found')
    expect(calls).toEqual([])
  })

  test('a skill-directory preview opens the verified folder externally', async () => {
    const directory = '/Users/chenai/.selection/workspaces/my-workspace/skills/lieflat-charts'
    const calls: string[] = []
    await openGeneratedFileAction({
      requestedPath: `file://${directory}`,
      action: 'preview',
      baseDir: '/Users/chenai/.selection/workspaces/my-workspace',
      searchFiles: async () => [{ type: 'directory', name: 'lieflat-charts', path: directory }],
      openPreview: (path) => { calls.push(`preview:${path}`) },
      openExternal: (path) => { calls.push(`external:${path}`) },
      reveal: (path) => { calls.push(`reveal:${path}`) },
    })
    expect(calls).toEqual([`external:${directory}`])
  })

  test('missing version targets retain their exact candidates for recovery, while denied paths never bypass access checks', async () => {
    const managed: Array<[string, string[] | undefined]> = []
    const opened: string[] = []
    const options = {
      requestedPath: fileName, action: 'versions' as const, baseDir: 'D:\\成果', baseDirs: ['E:\\项目'],
      statPath: async () => null,
      searchFiles: async () => [{ type: 'file' as const, name: fileName, path: wrongPath }],
      manageArtifact: (path: string, alternatives?: string[]) => { managed.push([path, alternatives]) },
      openPreview: (path: string) => { opened.push(path) }, reveal: (path: string) => { opened.push(path) },
    }
    await openGeneratedFileAction(options)
    expect(managed).toEqual([[realPath, [`E:\\项目\\${fileName}`]]])
    expect(opened).toEqual([])
    await expect(openGeneratedFileAction({ ...options, statPath: async () => { throw new Error('Access denied') } })).rejects.toThrow('Access denied')
    expect(managed).toHaveLength(1)
    expect(await openGeneratedFileAction({ ...options, action: 'external',
      statPath: async () => ({ path: realPath, type: 'file' }), openExternal: async () => false })).toBe(false)
  })

  test('opening versions waits for the artifact registration to finish', async () => {
    let registrationStarted!: () => void
    let finishRegistration!: () => void
    const started = new Promise<void>(resolve => { registrationStarted = resolve })
    const registration = new Promise<void>(resolve => { finishRegistration = resolve })
    const opening = openGeneratedFileAction({
      requestedPath: realPath,
      action: 'versions',
      statPath: async () => ({ path: realPath, type: 'file' }),
      searchFiles: async () => [],
      manageArtifact: () => { registrationStarted(); return registration },
      openPreview: () => {},
      reveal: () => {},
    })
    await started
    let settled = false
    void opening.then(() => { settled = true })
    expect(settled).toBe(false)
    finishRegistration()
    expect(await opening).toBe(true)
    expect(settled).toBe(true)
  })

  test('a card with a literal percent filename opens that exact version record', async () => {
    const literal = '/reports/Q3%20报告.pdf'
    const opened: string[] = []
    await openGeneratedFileAction({
      requestedPath: literal,
      action: 'versions',
      statPath: async path => path === literal ? { path, type: 'file' } : null,
      searchFiles: async () => [],
      manageArtifact: path => { opened.push(path) },
      openPreview: () => {},
      reveal: () => {},
    })
    expect(opened).toEqual([literal])
  })

  test('a saved version identity opens history after the original filename disappears', async () => {
    const calls: string[] = []
    await openGeneratedFileAction({
      requestedPath: '/reports/old.docx', action: 'versions', versionId: 'version-id',
      statPath: async () => { throw new Error('The old path is missing') },
      searchFiles: async () => [],
      manageArtifact: (path, alternatives, versionId) => { calls.push(`${path}:${versionId}:${alternatives?.length ?? 0}`) },
      openPreview: () => {}, reveal: () => {},
    })
    expect(calls).toEqual(['/reports/old.docx:version-id:0'])
  })

  test('a historical card previews its saved bytes after the path is reused', async () => {
    const opened: string[] = []
    await openGeneratedFileAction({
      requestedPath: '/reports/report.docx', action: 'preview', artifactId: 'old-artifact', versionId: 'old-version',
      statPath: async () => { throw new Error('The original path now belongs to another file') },
      searchFiles: async () => [],
      previewVersion: async (artifactId, versionId) => `/snapshots/${artifactId}/${versionId}.docx`,
      openPreview: path => { opened.push(path) }, reveal: () => {},
    })
    expect(opened).toEqual(['/snapshots/old-artifact/old-version.docx'])
    await expect(openGeneratedFileAction({
      requestedPath: '/reports/report.docx', action: 'preview', versionId: 'old-version',
      statPath: async () => ({ path: '/reports/report.docx', type: 'file' }),
      searchFiles: async () => [], openPreview: path => { opened.push(path) }, reveal: () => {},
    })).rejects.toThrow('preview is unavailable')
    expect(opened).toHaveLength(1)
  })

  test('external open follows the saved identity and refuses a reused path', async () => {
    const opened: string[] = []
    const options = {
      requestedPath: '/reports/old.docx', action: 'external' as const, artifactId: 'artifact',
      statPath: async (path: string) => ({ path, type: 'file' as const }),
      searchFiles: async () => [], openPreview: () => {},
      openExternal: (path: string) => { opened.push(path) }, reveal: () => {},
      readArtifact: async () => ({ path: '/reports/renamed.docx', currentFileAvailable: true }),
    }
    await openGeneratedFileAction(options)
    expect(opened).toEqual(['/reports/renamed.docx'])
    await expect(openGeneratedFileAction({ ...options,
      readArtifact: async () => ({ path: '/reports/old.docx', currentFileAvailable: false }) })).rejects.toThrow('no longer available')
    expect(opened).toHaveLength(1)
  })
})
