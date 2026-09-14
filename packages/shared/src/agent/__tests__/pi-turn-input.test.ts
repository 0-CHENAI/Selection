import { expect, test } from 'bun:test';
import { assemblePiTurnInput } from '../pi-turn-input.ts';
import type { FileAttachment } from '../../utils/files.ts';

const input = { systemPrompt: 'platform', stableParts: ['stable'], volatileParts: ['volatile'], message: 'question' };
const attachment = (overrides: Partial<FileAttachment>): FileAttachment => ({
  type: 'text', path: '', name: 'file', mimeType: 'text/plain', size: 1, ...overrides,
});

test('keeps stable and volatile context in their existing order without mutating the capture', () => {
  const captured = structuredClone(input);
  expect(assemblePiTurnInput({ ...input, answerDeliveryPrompt: 'delivery' })).toEqual({
    systemPrompt: 'platform\n\ndelivery\n\nstable', message: 'volatile\n\nquestion',
    images: undefined, attachmentParts: [],
  });
  expect(input).toEqual(captured);
});

test('preserves image bytes and document metadata in actual user-input order', () => {
  const result = assemblePiTurnInput({ ...input, attachments: [
    attachment({ type: 'image', mimeType: 'image/png', base64: 'AQ==', path: '/image', name: 'pixel' }),
    attachment({ mimeType: 'application/pdf', storedPath: '/pdf' }),
    attachment({ type: 'office', storedPath: '/office' }),
    attachment({ storedPath: '/text', markdownPath: '/markdown' }),
  ] });
  expect(result.images).toEqual([{ type: 'image', data: 'AQ==', mimeType: 'image/png' }]);
  expect(result.attachmentParts).toEqual([
    '[Attached image: pixel]\nThe image is included as visual input — look at it. Path: /image',
    '[Attached PDF: file]\n[Stored at: /pdf]',
    '[Attached Office document: file]\n[Stored at: /office]',
    '[Attached file: file]\n[Stored at: /text]\n[Markdown version: /markdown]',
  ]);
  expect(result.message).toBe(['volatile', ...result.attachmentParts, 'question'].join('\n\n'));
});

test('refuses unavailable image bytes instead of silently dropping visual input', () => {
  expect(() => assemblePiTurnInput({ ...input, attachments: [
    attachment({ type: 'image', mimeType: 'image/png', name: 'missing' }),
  ] })).toThrow('image_bytes_unavailable');
});
