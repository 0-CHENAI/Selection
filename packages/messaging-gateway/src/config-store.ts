/**
 * ConfigStore — workspace-scoped messaging config.json persistence.
 *
 * Stored at `{storageDir}/config.json`. Shape is `MessagingConfig`.
 * One-shot migration from a legacy directory is supported (mirrors BindingStore).
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MESSAGING_CONFIG, type MessagingConfig, type MessagingLogger } from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export class ConfigStore {
  private readonly dirPath: string
  private readonly filePath: string
  private readonly log: MessagingLogger
  private config: MessagingConfig

  constructor(storageDir: string, legacyDir?: string, logger: MessagingLogger = NOOP_LOGGER) {
    this.dirPath = storageDir
    this.filePath = join(storageDir, 'config.json')
    this.log = logger
    this.migrateLegacy(legacyDir)
    const loaded = this.load()
    this.config = loaded.config
    if (loaded.shouldRewrite) this.save()
  }

  get(): MessagingConfig {
    const lark = this.config.platforms.lark
    return {
      ...this.config,
      platforms: lark
        ? {
            lark: {
              ...lark,
              ...(lark.owners ? { owners: lark.owners.map((owner) => ({ ...owner })) } : {}),
            },
          }
        : {},
    }
  }

  update(partial: Partial<MessagingConfig>): MessagingConfig {
    const next: MessagingConfig = {
      enabled: partial.enabled ?? this.config.enabled,
      platforms: partial.platforms?.lark
        ? { lark: { ...(this.config.platforms.lark ?? { enabled: false }), ...partial.platforms.lark } }
        : { ...this.config.platforms },
    }
    this.config = next
    this.save()
    return this.get()
  }

  private migrateLegacy(legacyDir?: string): void {
    if (!legacyDir) return
    const legacyFile = join(legacyDir, 'config.json')
    if (existsSync(this.filePath)) return
    if (!existsSync(legacyFile)) return
    try {
      if (!existsSync(this.dirPath)) mkdirSync(this.dirPath, { recursive: true })
      copyFileSync(legacyFile, this.filePath)
      this.log.info('messaging config migrated from legacy location', {
        event: 'config_migrated',
        legacyFile,
        filePath: this.filePath,
      })
    } catch (err) {
      this.log.error('messaging config migration failed', {
        event: 'config_migration_failed',
        legacyFile,
        filePath: this.filePath,
        error: err,
      })
    }
  }

  private load(): { config: MessagingConfig; shouldRewrite: boolean } {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<MessagingConfig>
        const platforms = parsed.platforms && typeof parsed.platforms === 'object'
          ? parsed.platforms as Record<string, unknown>
          : {}
        return {
          config: {
            enabled: parsed.enabled ?? DEFAULT_MESSAGING_CONFIG.enabled,
            platforms: parsed.platforms?.lark ? { lark: parsed.platforms.lark } : {},
          },
          shouldRewrite: Object.keys(platforms).some((platform) => platform !== 'lark'),
        }
      }
    } catch (err) {
      this.log.error('failed to load messaging config', {
        event: 'config_load_failed',
        filePath: this.filePath,
        error: err,
      })
    }
    return {
      config: { ...DEFAULT_MESSAGING_CONFIG, platforms: {} },
      shouldRewrite: false,
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.dirPath)) mkdirSync(this.dirPath, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      this.log.error('failed to save messaging config', {
        event: 'config_save_failed',
        filePath: this.filePath,
        error: err,
      })
    }
  }
}
