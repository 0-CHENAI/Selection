import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ElectronAPI } from '../../shared/types'

/** Renderer HMR can precede a main-process restart. Keep existing files openable. */
export async function openHtmlFileWithFallback(path: string, api: Pick<ElectronAPI, 'browserPane' | 'isChannelAvailable' | 'openFile'>): Promise<'browser' | 'external'> {
  if (api.isChannelAvailable(RPC_CHANNELS.browserPane.OPEN_HTML_FILE) && typeof api.browserPane?.openHtmlFile === 'function') {
    try {
      await api.browserPane.openHtmlFile(path)
      return 'browser'
    } catch (error) {
      // Only a missing endpoint permits compatibility fallback; access and file
      // failures must retain their original meaning and authorization checks.
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'CHANNEL_NOT_FOUND') throw error
    }
  }
  await api.openFile(path)
  return 'external'
}
