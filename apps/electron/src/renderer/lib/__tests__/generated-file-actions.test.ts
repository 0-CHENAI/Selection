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
})
