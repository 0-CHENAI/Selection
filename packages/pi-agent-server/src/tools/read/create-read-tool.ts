import { constants } from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadToolDefinition, truncateHead } from '@earendil-works/pi-coding-agent'
import type { ReadOperations, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { detectReadImageMimeType } from './image-mime.ts'
import {
  processReadImage,
  type ReadImageProcessingDependencies,
  type ReadImageProcessingOptions,
} from './image-processing.ts'

class SelectionImagePayload extends Error {
  constructor(
    readonly bytes: Buffer,
    readonly mimeType: string,
  ) {
    super(`Selection image payload: ${mimeType}`)
  }
}

export function createSelectionReadToolDefinition(
  cwd: string,
  imageProcessingOptions?: ReadImageProcessingOptions,
  imageProcessingDependencies?: ReadImageProcessingDependencies,
): ToolDefinition<any, any> {
  const operations: ReadOperations = {
    access: path => access(path, constants.R_OK),
    async readFile(path) {
      const bytes = await readFile(path)
      const mimeType = detectReadImageMimeType(bytes)
      // Stop before Pi's built-in processImage/Base64 path. execute() below
      // catches this payload and hands the original bytes to Selection.
      if (mimeType) throw new SelectionImagePayload(bytes, mimeType)
      return bytes
    },
  }
  const baseTool = createReadToolDefinition(cwd, { operations })

  return {
    ...baseTool,
    async execute(
      ...args: Parameters<typeof baseTool.execute>
    ): Promise<Awaited<ReturnType<typeof baseTool.execute>>> {
      let image: SelectionImagePayload
      try {
        // Capture each invocation separately: parallel reads must not exchange identities.
        let captured: { path: string; bytes: Buffer } | undefined
        const invocation = createReadToolDefinition(cwd, {
          operations: {
            ...operations,
            async readFile(path) {
              const canonical = await realpath(path)
              const bytes = await operations.readFile(path)
              captured = { path: canonical, bytes }
              return bytes
            },
          },
        })
        const result = await invocation.execute(...args)
        if (!captured || captured.bytes.includes(0)) return result
        let text: string
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured.bytes) } catch { return result }
        const params = args[1] as { offset?: number; limit?: number }
        if (params.offset !== undefined && (!Number.isInteger(params.offset) || params.offset < 1)
          || params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1)) return result
        const start = (params.offset ?? 1) - 1
        const selected = text.split('\n').slice(start, params.limit === undefined ? undefined : start + params.limit).join('\n')
        const returned = truncateHead(selected)
        const delivered = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
        if (returned.firstLineExceedsLimit || !returned.content || !delivered.startsWith(returned.content)) return result
        const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
        const enriched = {
          ...result,
          details: {
            ...result.details,
            sourceRead: {
              path: captured.path,
              contentHash: hash(captured.bytes),
              startLine: start + 1,
              endLine: start + returned.outputLines,
              returnedTextHash: hash(returned.content),
            },
          },
        }
        return enriched
      } catch (error) {
        if (!(error instanceof SelectionImagePayload)) throw error
        image = error
      }

      if (args[2]?.aborted) {
        const error = new Error('Operation aborted')
        error.name = 'AbortError'
        throw error
      }

      const processed = await processReadImage(
        image.bytes,
        image.mimeType,
        imageProcessingOptions,
        imageProcessingDependencies,
        args[2],
      )

      const context = args[4] as { model?: { input?: string[] } } | undefined
      const visionSupported = context?.model?.input?.includes('image') !== false

      if (!processed.ok) {
        return {
          content: [{
            type: 'text',
            text: [
              `Read image file [${image.mimeType}]`,
              processed.message,
              visionSupported
                ? undefined
                : 'image_capability_mismatch: Current model does not accept image input. The image was not included in this request.',
            ].filter(Boolean).join('\n'),
          }],
          details: undefined,
        }
      }

      if (!visionSupported) {
        return {
          content: [{
            type: 'text',
            text: [
              `Read image file [${processed.mimeType}]`,
              'image_capability_mismatch: Current model does not accept image input. The image was not included in this request.',
              ...processed.hints,
            ].join('\n'),
          }],
          details: undefined,
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `Read image file [${processed.mimeType}]`,
              ...processed.hints,
            ].join('\n'),
          },
          {
            type: 'image',
            data: processed.data,
            mimeType: processed.mimeType,
          },
        ],
        details: undefined,
      }
    },
  } as unknown as ToolDefinition<any, any>
}
