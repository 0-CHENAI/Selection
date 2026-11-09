import { describe, expect, test, mock } from 'bun:test'
import { openHtmlFileWithFallback } from '../open-html-file'
import type { ElectronAPI } from '../../../shared/types'

const path = 'D:\\中文 空格\\报告.html'
function api(available = true) {
  return {
    isChannelAvailable: mock(() => available),
    browserPane: { openHtmlFile: mock(async () => 'browser') },
    openFile: mock(async () => {}),
  } as unknown as Pick<ElectronAPI, 'browserPane' | 'isChannelAvailable' | 'openFile'>
}
describe('HTML opening across renderer/main versions', () => {
  test('uses the built-in browser when its handler is advertised', async () => {
    const client = api()
    expect(await openHtmlFileWithFallback(path, client)).toBe('browser')
    expect(client.browserPane.openHtmlFile).toHaveBeenCalledWith(path)
    expect(client.openFile).not.toHaveBeenCalled()
  })
  test('an older main uses the existing authorized file opener without an unknown RPC', async () => {
    const client = api(false)
    expect(await openHtmlFileWithFallback(path, client)).toBe('external')
    expect(client.browserPane.openHtmlFile).not.toHaveBeenCalled()
    expect(client.openFile).toHaveBeenCalledWith(path)
  })
  test('a legacy handshake that omits capabilities still handles CHANNEL_NOT_FOUND', async () => {
    const client = api()
    client.browserPane.openHtmlFile = mock(async () => { throw Object.assign(new Error('No handler'), { code: 'CHANNEL_NOT_FOUND' }) })
    expect(await openHtmlFileWithFallback(path, client)).toBe('external')
    expect(client.openFile).toHaveBeenCalledTimes(1)
  })
  test('an API object created before renderer HMR can lack the new method', async () => {
    const client = api()
    delete (client.browserPane as Partial<ElectronAPI['browserPane']>).openHtmlFile
    expect(await openHtmlFileWithFallback(path, client)).toBe('external')
  })
  test('access, missing-file and transport failures never become fallback success', async () => {
    for (const code of ['HANDLER_ERROR', 'ACCESS_DENIED', 'ENOENT', 'CONNECTION_LOST']) {
      const client = api()
      const failure = Object.assign(new Error(code), { code })
      client.browserPane.openHtmlFile = mock(async () => { throw failure })
      await expect(openHtmlFileWithFallback(path, client)).rejects.toBe(failure)
      expect(client.openFile).not.toHaveBeenCalled()
    }
  })
  test('an external-open failure is reported rather than marked opened', async () => {
    const client = api(false)
    client.openFile = mock(async () => { throw new Error('File not found') })
    await expect(openHtmlFileWithFallback(path, client)).rejects.toThrow('File not found')
  })
})
