/**
 * One-time compatibility cleanup for platform integrations removed in 1.2.x.
 * Keep the retired identifiers isolated here so product code cannot register
 * or expose them accidentally.
 */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { MessagingLogger } from './types'

export const RETIRED_PLATFORM_IDS = ['telegram', 'whatsapp'] as const
const RETIRED_LOCAL_PATHS = ['whatsapp-auth', 'topics.json'] as const

export async function cleanupRetiredMessagingData(
  storageDir: string,
  workspaceId: string,
  credentials: CredentialManager,
  logger: MessagingLogger,
): Promise<void> {
  for (const name of RETIRED_PLATFORM_IDS) {
    await credentials
      .delete({ type: 'messaging_bearer', workspaceId, name })
      .catch((error) => logger.warn('retired credential cleanup failed', {
        event: 'retired_credential_cleanup_failed',
        workspaceId,
        name,
        error,
      }))
  }

  for (const relativePath of RETIRED_LOCAL_PATHS) {
    const target = join(storageDir, relativePath)
    if (!existsSync(target)) continue
    try {
      rmSync(target, { recursive: true, force: true })
      logger.info('retired messaging data removed', {
        event: 'retired_messaging_data_removed',
        workspaceId,
        relativePath,
      })
    } catch (error) {
      logger.warn('retired messaging data cleanup failed', {
        event: 'retired_messaging_data_cleanup_failed',
        workspaceId,
        relativePath,
        error,
      })
    }
  }
}
