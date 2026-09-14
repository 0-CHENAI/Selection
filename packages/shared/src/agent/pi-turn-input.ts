import { hydrateAttachmentBytes, imageAttachmentsMissingBytes, type FileAttachment } from '../utils/files.ts';
import type { Context } from '@earendil-works/pi-ai';

export interface AgentPromptInput {
  systemPrompt: string;
  message: string;
  images?: Array<{ type: 'image'; data: string; mimeType: string }>;
}

export interface AgentInputSnapshot {
  context: Context;
  model: { id: string; api: string; provider: string; contextWindow: number };
  hash: string;
}

/** The final text/attachment assembly shared by execution and input inspection.
 * Callers must capture volatile context once: building it can consume signals.
 * This does not resolve tools, model configuration, or earlier skill directives.
 */
export function assemblePiTurnInput(input: {
  systemPrompt: string;
  answerDeliveryPrompt?: string;
  stableParts: string[];
  volatileParts: string[];
  message: string;
  attachments?: FileAttachment[];
}) {
  const attachmentParts: string[] = [];
  const images: NonNullable<AgentPromptInput['images']> = [];
  const attachments = hydrateAttachmentBytes(input.attachments) || [];
  const missing = imageAttachmentsMissingBytes(attachments);
  if (missing.length) {
    throw new Error(`image_bytes_unavailable: Image bytes could not be loaded for the model request: ${missing.map(att => att.name).join(', ')}.`);
  }
  for (const att of attachments) {
    const isImage = att.type === 'image' || att.mimeType?.startsWith('image/') === true;
    if (isImage && att.base64) {
      images.push({ type: 'image', data: att.base64, mimeType: att.mimeType || 'image/png' });
      const stored = att.storedPath || att.path;
      if (stored) attachmentParts.push(`[Attached image: ${att.name}]\nThe image is included as visual input — look at it. Path: ${stored}`);
    } else if (att.mimeType === 'application/pdf' && att.storedPath) {
      attachmentParts.push(`[Attached PDF: ${att.name}]\n[Stored at: ${att.storedPath}]`);
    } else if (att.type === 'office' && att.storedPath) {
      attachmentParts.push(`[Attached Office document: ${att.name}]\n[Stored at: ${att.storedPath}]`);
    } else if (att.storedPath) {
      let part = `[Attached file: ${att.name}]\n[Stored at: ${att.storedPath}]`;
      if (att.markdownPath) part += `\n[Markdown version: ${att.markdownPath}]`;
      attachmentParts.push(part);
    }
  }
  // Keep volatile blocks out of the cacheable system prefix (issue #862).
  return {
    systemPrompt: [input.systemPrompt, input.answerDeliveryPrompt, ...input.stableParts].filter(Boolean).join('\n\n'),
    message: [...input.volatileParts, ...attachmentParts, input.message].filter(Boolean).join('\n\n'),
    images: images.length ? images : undefined,
    attachmentParts,
  };
}
