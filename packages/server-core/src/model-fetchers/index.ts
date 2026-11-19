/**
 * Model Refresh Service
 *
 * Centralized service for fetching and refreshing model lists across all providers.
 * Replaces the scattered fetchAndStore*Models() functions and startCodexModelRefresh().
 *
 * Fallback chain (same for every provider):
 * 1. Provider runtime discovery via backend driver dispatch
 * 2. Persisted connection.models — previously fetched, survives offline/restart
 * 3. MODEL_REGISTRY — hardcoded offline seed data, last resort
 */

import { isDeepStrictEqual } from 'node:util'
import type { ModelFetcherMap, ModelFetcherCredentials, FetchableProvider } from '@craft-agent/shared/config'
import type { LlmConnection, ModelDefinition } from '@craft-agent/shared/config'
import {
  getLlmConnections,
  getLlmConnection,
  updateLlmConnection,
  isCompatProvider,
  isUnsupportedLlmConnection,
  getModelsForProviderType,
} from '@craft-agent/shared/config'
import { MODEL_FETCHERS } from './registry'
import { handlerLog } from './runtime'

/** Poll account-managed catalogs for model and policy changes. */
const ACCOUNT_REFRESH_INTERVAL_MS = 10 * 60 * 1000

function hasAccountCatalog(connection: LlmConnection): boolean {
  return connection.providerType === 'pi' && connection.authType === 'oauth'
    && (connection.piAuthProvider === 'openai-codex' || connection.piAuthProvider === 'github-copilot')
}

// Model availability belongs to the account. Keep local overrides only for IDs
// that are still visible, using the settings reread after the network request.
function mergeChatGptModelSettings(models: ModelDefinition[], stored: LlmConnection['models']): ModelDefinition[] {
  const previous = new Map((stored ?? []).filter((item): item is ModelDefinition => typeof item !== 'string')
    .map(item => [item.id, item]))
  return models.map(model => {
    const local = previous.get(model.id)
    if (!local) return model
    if (local.imageSupport === 'on' || local.imageSupport === 'off') {
      model = { ...model, imageSupport: local.imageSupport, supportsImages: local.imageSupport === 'on' }
    } else if (local.imageSupport === 'auto' && local.learnedSupportsImages !== undefined) {
      model = { ...model, imageSupport: 'auto', learnedSupportsImages: local.learnedSupportsImages }
    }
    if (local.thinkingSource === 'explicit') {
      const { thinkingMode, supportedThinkingLevels, supportsThinking, ...other } = model
      return {
        ...other, thinkingSource: 'explicit',
        ...(local.thinkingMode !== undefined && { thinkingMode: local.thinkingMode }),
        ...(local.supportedThinkingLevels !== undefined && { supportedThinkingLevels: local.supportedThinkingLevels }),
        ...(local.supportsThinking !== undefined && { supportsThinking: local.supportsThinking }),
      }
    }
    return model
  })
}

// ============================================================
// Types
// ============================================================

type CredentialResolver = (slug: string, connection: LlmConnection) => Promise<ModelFetcherCredentials>

// ============================================================
// ModelRefreshService
// ============================================================

class ModelRefreshService {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private inFlight = new Map<string, Promise<string | void>>()
  private stopped = false

  constructor(
    private fetchers: ModelFetcherMap,
    private getCredentials: CredentialResolver,
  ) {}

  /**
   * Fetch models for a connection through the fallback chain.
   * Deduplicates concurrent calls for the same slug — if a refresh is already
   * in progress, callers share the same promise instead of racing.
   */
  async refreshConnection(slug: string): Promise<string | void> {
    const existing = this.inFlight.get(slug)
    if (existing) return existing

    const promise = this._doRefresh(slug).finally(() => {
      this.inFlight.delete(slug)
    })
    this.inFlight.set(slug, promise)
    return promise
  }

  /**
   * Internal: actual refresh logic with fallback chain.
   * Skips compat providers (not in fetcher map).
   * Preserves user's defaultModel if still valid.
   * Updates connection.models in storage on success.
   */
  private async _doRefresh(slug: string): Promise<string | void> {
    let connection = getLlmConnection(slug)
    if (!connection) {
      handlerLog.warn(`Model refresh: connection not found: ${slug}`)
      return
    }

    // Skip compat providers — users configure models manually
    if (isCompatProvider(connection.providerType)) {
      return
    }

    if (isUnsupportedLlmConnection(connection)) {
      handlerLog.warn(`Model refresh: skipping unsupported connection ${slug}`)
      return
    }

    const providerType = connection.providerType as FetchableProvider
    const isCopilot = connection.providerType === 'pi' && connection.piAuthProvider === 'github-copilot'
    const fetcher = this.fetchers[providerType]
    if (!fetcher) {
      handlerLog.warn(`Model refresh: no fetcher for provider type: ${providerType}`)
      return
    }

    let newModels: ModelDefinition[] | null = null
    let serverDefault: string | undefined
    let discoveryError: string | undefined
    let usedCredentials: ModelFetcherCredentials | undefined

    // Layer 1: Provider API/SDK
    try {
      const credentials = await this.getCredentials(slug, connection)
      usedCredentials = credentials
      handlerLog.info(`Model refresh [${slug}]: fetching (provider=${connection.providerType}, piAuth=${connection.piAuthProvider}, hasOAuthRefresh=${!!credentials.oauthRefreshToken}, hasOAuthAccess=${!!credentials.oauthAccessToken})`)
      const result = await fetcher.fetchModels(connection, credentials)
      newModels = result.models
      serverDefault = result.serverDefault
      handlerLog.info(`Model refresh [${slug}]: fetched ${newModels.length} models from provider: ${newModels.map(m => m.id).join(', ')}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (connection.piAuthProvider === 'openai-codex' && hasAccountCatalog(connection)) discoveryError = msg
      handlerLog.warn(`Model refresh [${slug}]: provider fetch failed: ${msg}`)
    }

    const accountCatalog = hasAccountCatalog(connection)
    if (newModels && accountCatalog) {
      try {
        const currentCredentials = await this.getCredentials(slug, connection)
        if ((usedCredentials?.oauthRefreshToken || usedCredentials?.oauthAccessToken)
          !== (currentCredentials.oauthRefreshToken || currentCredentials.oauthAccessToken)) {
          handlerLog.info(`Model refresh [${slug}]: credentials changed during fetch; discarding result`)
          return
        }
      } catch {
        handlerLog.warn(`Model refresh [${slug}]: could not verify current credentials; discarding result`)
        return
      }
    }

    // The network request can overlap edits, deletion, or recreation of this
    // connection. Never apply a catalog to a different account/provider.
    const latest = getLlmConnection(slug)
    if (!latest || latest.createdAt !== connection.createdAt || latest.providerType !== connection.providerType
      || latest.authType !== connection.authType || latest.piAuthProvider !== connection.piAuthProvider
      || latest.baseUrl !== connection.baseUrl || latest.oauthAccountUuid !== connection.oauthAccountUuid
      || latest.oauthOrganizationUuid !== connection.oauthOrganizationUuid
      || latest.oauthProfileVerifiedAt !== connection.oauthProfileVerifiedAt) {
      handlerLog.info(`Model refresh [${slug}]: connection changed during fetch; discarding result`)
      return
    }
    connection = latest

    const hasLiveChatGptCatalog = accountCatalog && connection.piAuthProvider === 'openai-codex' && newModels !== null
    if (hasLiveChatGptCatalog && newModels) {
      newModels = mergeChatGptModelSettings(newModels, connection.models)
      const validDefault = newModels.length ? newModels.some(model => model.id === connection.defaultModel) : !connection.defaultModel
      if (validDefault && connection.chatgptCatalogFetchedAt !== undefined
        && connection.modelSelectionMode === 'automaticallySyncedFromProvider' && isDeepStrictEqual(connection.models, newModels)) return
    }
    const chatgptLive = hasLiveChatGptCatalog ? { chatgptCatalogFetchedAt: Date.now() } : {}

    // Layer 2: Persisted connection.models (keep what we have)
    if (!newModels && connection.models && connection.models.length > 0) {
      handlerLog.warn(`Model refresh [${slug}]: keeping ${connection.models.length} stale persisted models (live fetch failed)`)
      return discoveryError
    }

    // An empty account catalog must survive a failed refresh.
    if (!newModels && accountCatalog && (isCopilot || connection.chatgptCatalogFetchedAt !== undefined)) {
      handlerLog.warn(`Model refresh [${slug}]: keeping account catalog after failed refresh`)
      return discoveryError
    }

    // Layer 3: MODEL_REGISTRY hardcoded fallback
    if (!newModels) {
      const registryModels = getModelsForProviderType(providerType, connection.piAuthProvider)
      if (registryModels.length > 0) {
        newModels = registryModels
        handlerLog.info(`Model refresh [${slug}]: using ${newModels.length} models from MODEL_REGISTRY`)
      }
    }

    if (newModels && newModels.length === 0 && accountCatalog) {
      updateLlmConnection(slug, {
        ...chatgptLive,
        models: [],
        defaultModel: '',
        modelSelectionMode: 'automaticallySyncedFromProvider',
      })
      return
    }

    if (!newModels || newModels.length === 0) {
      handlerLog.warn(`Model refresh [${slug}]: no models available from any source`)
      return discoveryError
    }

    // For Pi API-key connections with explicit user-owned selection,
    // never overwrite model lists from background refresh. OAuth catalogs
    // are provider-managed even if a legacy connection has a custom mode.
    // Exception: Copilot connections are always server-managed — GitHub's
    // model policy controls which models are enabled, so we must always
    // accept the live API result.
    if (connection.providerType === 'pi' && connection.authType !== 'oauth' && connection.modelSelectionMode === 'userDefined3Tier' && !isCopilot) {
      const modelCount = connection.models?.length ?? 0
      handlerLog.info(`Model refresh [${slug}]: preserving user-defined Pi model list (${modelCount} models)`)
      if (modelCount > 10) {
        handlerLog.warn(`Model refresh [${slug}]: userDefined3Tier has suspicious model count (${modelCount})`)
      }
      return
    }

    // Preserve user's defaultModel if still valid
    const currentDefault = connection.defaultModel
    const stillValid = currentDefault && newModels.some(m => m.id === currentDefault)
    const newDefault = stillValid ? currentDefault
      : (serverDefault && newModels.some(model => model.id === serverDefault) ? serverDefault : newModels[0]?.id)

    updateLlmConnection(slug, {
      ...chatgptLive,
      models: newModels,
      ...(connection.providerType === 'pi' && connection.authType === 'oauth'
        ? { modelSelectionMode: 'automaticallySyncedFromProvider' as const }
        : {}),
      ...(newDefault && !stillValid ? { defaultModel: newDefault } : {}),
    })
    return discoveryError
  }

  /**
   * Start periodic refresh timers for all existing connections.
   * Also runs an immediate non-blocking fetch for each.
   * Call on app startup after IPC handlers are registered.
   */
  startAll(): void {
    this.stopped = false
    const connections = getLlmConnections()

    for (const conn of connections) {
      if (isCompatProvider(conn.providerType) || isUnsupportedLlmConnection(conn)) continue

      const providerType = conn.providerType as FetchableProvider
      const fetcher = this.fetchers[providerType]
      if (!fetcher) continue

      // Immediate non-blocking fetch
      this.refreshConnection(conn.slug).catch(err => {
        handlerLog.warn(`Initial model refresh failed for ${conn.slug}: ${err instanceof Error ? err.message : err}`)
      })

      if (hasAccountCatalog(conn)) {
        this.startTimer(conn.slug, ACCOUNT_REFRESH_INTERVAL_MS)
      } else if (fetcher.refreshIntervalMs > 0) {
        this.startTimer(conn.slug, fetcher.refreshIntervalMs)
      }
    }
  }

  /**
   * Stop all refresh timers. Call on app quit.
   */
  stopAll(): void {
    this.stopped = true
    for (const [slug, timer] of this.timers) {
      clearInterval(timer)
      handlerLog.info(`Stopped model refresh timer for ${slug}`)
    }
    this.timers.clear()
  }

  /**
   * Trigger an immediate refresh for a specific connection.
   * Also starts a periodic timer if the fetcher supports it.
   * Called when: connection created, auth completed, user clicks refresh.
   */
  async refreshNow(slug: string): Promise<void> {
    // A credential change can arrive during an older request. Waiting for it
    // and then fetching again prevents deduplication from losing the re-auth.
    const pending = this.inFlight.get(slug)
    if (pending) await pending
    const discoveryError = await this.refreshConnection(slug)

    // Ensure periodic timer is running
    const connection = getLlmConnection(slug)
    if (!connection || isCompatProvider(connection.providerType) || isUnsupportedLlmConnection(connection)) return

    const providerType = connection.providerType as FetchableProvider
    const fetcher = this.fetchers[providerType]
    if (hasAccountCatalog(connection) && !this.timers.has(slug)) {
      this.startTimer(slug, ACCOUNT_REFRESH_INTERVAL_MS)
    } else if (fetcher && fetcher.refreshIntervalMs > 0 && !this.timers.has(slug)) {
      this.startTimer(slug, fetcher.refreshIntervalMs)
    }
    if (discoveryError) throw new Error(discoveryError)
  }

  /**
   * Stop timer for a specific connection (e.g., when deleted).
   */
  stopConnection(slug: string): void {
    const timer = this.timers.get(slug)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(slug)
    }
  }

  private startTimer(slug: string, intervalMs: number): void {
    // Don't create duplicate timers
    if (this.stopped || this.timers.has(slug)) return

    const timer = setInterval(async () => {
      try {
        await this.refreshConnection(slug)
      } catch (err) {
        handlerLog.warn(`Periodic model refresh failed for ${slug}: ${err instanceof Error ? err.message : err}`)
      }
    }, intervalMs)

    this.timers.set(slug, timer)
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let _service: ModelRefreshService | null = null

/**
 * Get the ModelRefreshService singleton.
 * Must be initialized with initModelRefreshService() before use.
 */
export function getModelRefreshService(): ModelRefreshService {
  if (!_service) {
    throw new Error('ModelRefreshService not initialized. Call initModelRefreshService() first.')
  }
  return _service
}

/**
 * Initialize the ModelRefreshService with a credential resolver.
 * Called once during app startup.
 */
export function initModelRefreshService(getCredentials: CredentialResolver): ModelRefreshService {
  _service = new ModelRefreshService(MODEL_FETCHERS, getCredentials)
  return _service
}

export { setFetcherPlatform } from './runtime'
