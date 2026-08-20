import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { createReadToolDefinition } from '@earendil-works/pi-coding-agent'
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
        return await baseTool.execute(...args)
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
      const nonVisionNote = context?.model?.input?.includes('image') === false
        ? '[Current model does not support images. The image will be omitted from this request.]'
        : undefined

      if (!processed.ok) {
        return {
          content: [{
            type: 'text',
            text: [
              `Read image file [${image.mimeType}]`,
              processed.message,
              nonVisionNote,
            ].filter(Boolean).join('\n'),
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
              nonVisionNote,
            ].filter(Boolean).join('\n'),
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
