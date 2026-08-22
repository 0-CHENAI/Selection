import { existsSync, statSync } from 'node:fs'
import type { AgentProvider, LlmAuthType } from '@craft-agent/shared/agent/backend'
import { isCompatProvider, modelSupportsImages, type LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import {
  describeImageAttachment,
  hydrateAttachmentBytes,
  imageAttachmentsMissingBytes,
  withStoredImagePaths,
  type FileAttachment as HydratableAttachment,
  type ImageBlockDiagnostic,
  type ImageInputFailureCode,
  type StoredAttachmentSource,
} from '@craft-agent/shared/utils'

export interface BackendRuntimeSignatureInput {
  connection: LlmConnection | null
  provider: AgentProvider
  authType?: LlmAuthType
  resolvedModel: string
}

export interface ModelAttachmentFilterResult {
  /** Attachments safe to pass to the model, or undefined when none remain. */
  attachments?: FileAttachment[]
  /** Image attachments intentionally omitted from the model payload. */
  omittedImages: FileAttachment[]
}

function definedObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined))
}

function normalizeCustomModels(connection: LlmConnection): Array<Record<string, unknown>> {
  return (connection.models ?? [])
    .map(model => {
      if (typeof model === 'string') return { id: model }
      return definedObject({
        id: model.id,
        contextWindow: model.contextWindow,
        supportsImages: typeof model.supportsImages === 'boolean' ? model.supportsImages : undefined,
      })
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

/**
 * Build a stable signature over the fields that the `update_runtime_config`
 * IPC envelope cannot safely propagate to a live subprocess. When this
 * signature drifts, the in-place refresh path must be skipped in favour of
 * a clean dispose + recreate so the new auth/provider routing actually takes
 * effect.
 *
 * Concretely, `update_runtime_config` (see `pi-agent.ts:requestRuntimeConfigUpdate`
 * and the matching handler at `pi-agent-server/src/index.ts:handleUpdateRuntimeConfig`)
 * carries `model, providerType, authType, baseUrl, customEndpoint, customModels` —
 * but NOT `piAuthProvider`, and switching `slug`/`providerType`/`authType` mid-life
 * pulls in credential routing and provider-registry state the subprocess doesn't
 * fully reset on a runtime update.
 */
export function buildRestartRequiredSignature(input: BackendRuntimeSignatureInput): string {
  const { connection, provider, authType } = input
  return JSON.stringify(definedObject({
    provider,
    authType,
    slug: connection?.slug,
    providerType: connection?.providerType,
    piAuthProvider: connection?.piAuthProvider,
  }))
}

/**
 * Build a stable signature for config fields that affect an already-created
 * backend runtime. Metadata such as `lastUsedAt` is intentionally omitted.
 */
export function buildBackendRuntimeSignature(input: BackendRuntimeSignatureInput): string {
  const { connection, provider, authType, resolvedModel } = input

  const connectionShape = connection
    ? definedObject({
        slug: connection.slug,
        providerType: connection.providerType,
        authType: connection.authType,
        defaultModel: connection.defaultModel,
        ...(isCompatProvider(connection.providerType)
          ? {
              baseUrl: connection.baseUrl,
              piAuthProvider: connection.piAuthProvider,
              customEndpoint: connection.customEndpoint
                ? definedObject({
                    api: connection.customEndpoint.api,
                    supportsImages: typeof connection.customEndpoint.supportsImages === 'boolean'
                      ? connection.customEndpoint.supportsImages
                      : undefined,
                  })
                : undefined,
              models: normalizeCustomModels(connection),
            }
          : {}),
      })
    : null

  return JSON.stringify(definedObject({
    provider,
    authType,
    resolvedModel,
    connection: connectionShape,
  }))
}

export function isImageAttachment(attachment: Pick<FileAttachment, 'type' | 'mimeType'>): boolean {
  return attachment.type === 'image' || attachment.mimeType?.startsWith('image/') === true
}

/**
 * Classify attachments that a text-only custom endpoint must not receive.
 * Callers must treat `omittedImages` as a hard send failure (#61), not a
 * silent text-only fallback.
 */
export function filterAttachmentsForModelInput(
  attachments: FileAttachment[] | undefined,
  connection: LlmConnection | null,
  modelId: string,
): ModelAttachmentFilterResult {
  if (!attachments?.length) return { attachments, omittedImages: [] }
  if (!connection || !isCompatProvider(connection.providerType)) return { attachments, omittedImages: [] }
  if (modelSupportsImages(connection, modelId)) return { attachments, omittedImages: [] }

  const modelAttachments: FileAttachment[] = []
  const omittedImages: FileAttachment[] = []

  for (const attachment of attachments) {
    if (isImageAttachment(attachment)) {
      omittedImages.push(attachment)
    } else {
      modelAttachments.push(attachment)
    }
  }

  return {
    attachments: modelAttachments.length > 0 ? modelAttachments : undefined,
    omittedImages,
  }
}

export interface PrepareModelImageAttachmentsInput {
  attachments?: HydratableAttachment[]
  storedAttachments?: StoredAttachmentSource[]
  connection: LlmConnection | null
  modelId: string
}

export type PrepareModelImageAttachmentsResult =
  | {
      ok: true
      attachments?: HydratableAttachment[]
      diagnostics: ImageBlockDiagnostic[]
      payloadImageCount: number
    }
  | {
      ok: false
      code: ImageInputFailureCode
      message: string
      diagnostics: ImageBlockDiagnostic[]
      payloadImageCount: 0
    }

/**
 * Rebuild, hydrate, and gate image attachments before they reach the model.
 * A vision-capable model only proceeds when every image has bytes in the
 * sendable payload. Capability mismatches and missing pixels fail closed.
 */
function isMissingImageSource(attachment: HydratableAttachment): boolean {
  const path = attachment.storedPath || attachment.path
  if (!path) return true
  try {
    return !existsSync(path) || !statSync(path).isFile()
  } catch {
    return true
  }
}

export function prepareModelImageAttachments(
  input: PrepareModelImageAttachmentsInput,
): PrepareModelImageAttachmentsResult {
  const source = withStoredImagePaths(input.attachments, input.storedAttachments)
  const capability = filterAttachmentsForModelInput(
    source as FileAttachment[] | undefined,
    input.connection,
    input.modelId,
  )
  if (capability.omittedImages.length > 0) {
    const names = capability.omittedImages.map(attachment => attachment.name).join(', ')
    return {
      ok: false,
      code: 'image_capability_mismatch',
      message: `Image input is disabled for ${input.modelId}. ${names} ${capability.omittedImages.length === 1 ? 'was' : 'were'} not sent.`,
      diagnostics: capability.omittedImages.map(attachment => describeImageAttachment(attachment)),
      payloadImageCount: 0,
    }
  }

  const hydrated = hydrateAttachmentBytes(capability.attachments as HydratableAttachment[] | undefined)
  const diagnostics = (hydrated ?? [])
    .filter(isImageAttachment)
    .map(attachment => describeImageAttachment(attachment))
  const missing = imageAttachmentsMissingBytes(hydrated)
  if (missing.length > 0) {
    const expiredOnly = missing.every(isMissingImageSource)
    const names = missing.map(attachment => attachment.name).join(', ')
    return {
      ok: false,
      code: expiredOnly ? 'image_resource_expired' : 'image_bytes_unavailable',
      message: expiredOnly
        ? `Stored image file${missing.length === 1 ? ' is' : 's are'} missing or no longer readable: ${names}.`
        : `Image bytes could not be loaded for the model request: ${names}.`,
      diagnostics,
      payloadImageCount: 0,
    }
  }

  return {
    ok: true,
    attachments: hydrated,
    diagnostics,
    payloadImageCount: diagnostics.length,
  }
}
