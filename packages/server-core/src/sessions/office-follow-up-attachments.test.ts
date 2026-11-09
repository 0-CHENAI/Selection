import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OFFICE_FOLLOW_UP_ATTACHMENT_CONFLICT, type FileAttachment, type OfficeSelection, type SendMessageOptions } from '@craft-agent/shared/protocol'
import type { StoredAttachment } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager'

const image = { type: 'image', name: 'extra.png', mimeType: 'image/png', size: 4, path: 'extra.png', base64: 'AAAA' } as FileAttachment
const stored = { id: 'stored', type: 'image', name: 'extra.png', mimeType: 'image/png', size: 4, storedPath: '/tmp/extra.png' } as StoredAttachment
const selection = {
  previewId: 'preview', artifactId: 'artifact', baseVersion: 'version', path: '/deck.pptx', hash: 'a'.repeat(64),
  elements: [{ path: '/slide[13]/shape[1]', type: 'shape', summary: 'title', digest: 'b'.repeat(64) }],
} satisfies OfficeSelection

function session() {
  const root = mkdtempSync(join(tmpdir(), 'ppt-follow-up-attach-'))
  const manager = new SessionManager()
  const internal = manager as unknown as { ensureMessagesLoaded: () => Promise<void>; sessions: Map<string, unknown> }
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: root }
  const parent = createManagedSession({ id: 'ppt-session', workMode: 'PRO', ppt: {} }, workspace as never, { messagesLoaded: true })
  internal.sessions.set(parent.id, parent)
  internal.ensureMessagesLoaded = async () => { throw new Error('continued-without-office-revision') }
  return { manager, root, id: parent.id }
}

test('a mid PPT follow-up with no selection keeps image and file attachments', async () => {
  const { manager, root, id } = session()
  try {
    await expect(manager.sendMessage(id, '把这张图放进第 3 页', [image], [stored], { ppt: {} })).rejects.toThrow('continued-without-office-revision')
    await expect(manager.sendMessage(id, '再附一份说明', [image], [stored], {
      ppt: {}, officeSelection: { ...selection, elements: [] },
    })).rejects.toThrow('continued-without-office-revision')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a directed Office selection explains why attachments cannot ride along', async () => {
  const { manager, root, id } = session()
  try {
    await expect(manager.sendMessage(id, '改标题', [image], [stored], { ppt: {}, officeSelection: selection })).rejects.toThrow(OFFICE_FOLLOW_UP_ATTACHMENT_CONFLICT)
    await expect(manager.sendMessage(id, '改标题', undefined, undefined, {
      ppt: {}, officeSelection: selection, annotationFollowUps: [{ messageId: 'm', annotationId: 'a', text: 'note', updatedAt: 1 }],
    } as SendMessageOptions)).rejects.toThrow(OFFICE_FOLLOW_UP_ATTACHMENT_CONFLICT)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
