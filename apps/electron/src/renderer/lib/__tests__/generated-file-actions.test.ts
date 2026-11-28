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

  test('explicit live action opens the verified current HTML file without calling previewVersion, and refuses unavailable paths', async () => {
    const opened: string[] = []
    let snapshotCalls = 0
    const options = {
      requestedPath: '/project/dashboard.html',
      action: 'live' as const,
      artifactId: 'html-artifact',
      statPath: async (path: string) => ({ path, type: 'file' as const }),
      searchFiles: async () => [],
      previewVersion: async () => { snapshotCalls++; return '/snapshots/html-artifact/v1/dashboard.html' },
      openPreview: (path: string) => { opened.push(path) },
      reveal: () => {},
      readArtifact: async () => ({ path: '/project/renamed/dashboard.html', currentVersion: 'v2', currentFileAvailable: true }),
    }
    expect(await openGeneratedFileAction(options)).toBe(true)
    expect(opened).toEqual(['/project/renamed/dashboard.html'])
    expect(snapshotCalls).toBe(0)

    await expect(openGeneratedFileAction({
      ...options,
      readArtifact: async () => ({ path: '/project/dashboard.html', currentVersion: 'v2', currentFileAvailable: false }),
    })).rejects.toThrow('no longer available')
    expect(opened).toHaveLength(1)
  })

  test('versioned live action opens live HTML while current, and falls back to immutable snapshot for historical or unavailable versions', async () => {
    const opened: string[] = []
    const snapshots: string[] = []
    const baseOptions = {
      requestedPath: '/project/dashboard.html',
      action: 'live' as const,
      artifactId: 'html-artifact',
      versionId: 'v1',
      statPath: async (path: string) => ({ path, type: 'file' as const }),
      searchFiles: async () => [],
      previewVersion: async (artifactId: string, versionId: string) => {
        const snapshot = `/snapshots/${artifactId}/${versionId}/dashboard.html`
        snapshots.push(snapshot)
        return snapshot
      },
      openPreview: (path: string) => { opened.push(path) },
      reveal: () => {},
    }

    // Current version on disk: open the live file so relative assets (JS/CSS/images) load.
    expect(await openGeneratedFileAction({
      ...baseOptions,
      readArtifact: async () => ({ path: '/project/renamed/dashboard.html', currentVersion: 'v1', currentFileAvailable: true }),
    })).toBe(true)
    expect(opened).toEqual(['/project/renamed/dashboard.html'])
    expect(snapshots).toEqual([])

    // Historical version after a newer version exists: preserve the immutable snapshot.
    expect(await openGeneratedFileAction({
      ...baseOptions,
      readArtifact: async () => ({ path: '/project/dashboard.html', currentVersion: 'v2', currentFileAvailable: true }),
    })).toBe(true)
    expect(opened).toEqual(['/project/renamed/dashboard.html', '/snapshots/html-artifact/v1/dashboard.html'])
    expect(snapshots).toEqual(['/snapshots/html-artifact/v1/dashboard.html'])

    // Original file replaced or deleted: preserve the immutable snapshot.
    expect(await openGeneratedFileAction({
      ...baseOptions,
      readArtifact: async () => ({ path: '/project/dashboard.html', currentVersion: 'v1', currentFileAvailable: false }),
    })).toBe(true)
    expect(opened).toHaveLength(3)
    expect(opened[2]).toBe('/snapshots/html-artifact/v1/dashboard.html')

    // File disappears between readArtifact and statPath: fall back to immutable snapshot.
    expect(await openGeneratedFileAction({
      ...baseOptions,
      statPath: async () => null,
      readArtifact: async () => ({ path: '/project/dashboard.html', currentVersion: 'v1', currentFileAvailable: true }),
    })).toBe(true)
    expect(opened).toHaveLength(4)
    expect(opened[3]).toBe('/snapshots/html-artifact/v1/dashboard.html')

    // Access denied must not bypass checks by falling back to snapshot.
    await expect(openGeneratedFileAction({
      ...baseOptions,
      statPath: async () => { throw new Error('Access denied') },
      readArtifact: async () => ({ path: '/project/dashboard.html', currentVersion: 'v1', currentFileAvailable: true }),
    })).rejects.toThrow('Access denied')
    expect(opened).toHaveLength(4)

    // Without previewVersion, a non-current version must fail instead of falling through to requestedPath.
    await expect(openGeneratedFileAction({
      ...baseOptions,
      previewVersion: undefined,
      readArtifact: async () => ({ path: '/project/dashboard.html', currentVersion: 'v2', currentFileAvailable: true }),
    })).rejects.toThrow('preview is unavailable')
    expect(opened).toHaveLength(4)
  })
})
