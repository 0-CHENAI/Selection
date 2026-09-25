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
})
