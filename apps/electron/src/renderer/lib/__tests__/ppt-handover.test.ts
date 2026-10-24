import { describe, expect, it } from 'bun:test'
import type { HandoverRecord, SessionCommand } from '@craft-agent/shared/protocol'
import type { Session } from '../../../shared/types'
import { ensurePptProSession } from '../ppt-handover'

const source: Session = { id: 'ordinary', workMode: 'NORM', workspaceId: 'ws', workspaceName: 'Workspace', messages: [], isProcessing: false, lastMessageAt: 0 }
function record(status: HandoverRecord['status'], extra: Partial<HandoverRecord> = {}): HandoverRecord {
  return { version: 1, handoverId: 'handover', sourceSessionId: source.id, workspaceId: source.workspaceId, targetMode: 'PRO', snapshotVersion: 1, status, createdAt: 1, updatedAt: 1, reviews: {}, ...extra }
}
describe('PPT context handover', () => {
  it('uses the immutable PRO target only after its snapshot is applied', async () => {
    const target = await ensurePptProSession(source, 'handover', async () => ({ records: [record('applied', { targetSessionId: 'pro-target' })] }), new AbortController().signal)
    expect(target).toBe('pro-target')
    expect(source.workMode).toBe('NORM')
  })
  it('cancels a busy source receipt rather than sending a deferred request after the user leaves', async () => {
    const commands: SessionCommand[] = []
    await expect(ensurePptProSession(source, 'handover', async (_id, command) => {
      commands.push(command)
      return { records: [record(command.type === 'handover' && command.operation.type === 'cancel' ? 'cancelled' : 'waiting', { error: '等待后台任务完成' })] }
    }, new AbortController().signal)).rejects.toThrow('等待后台任务完成')
    expect(commands).toEqual([
      { type: 'handover', operation: { type: 'create', handoverId: 'handover', targetMode: 'PRO' } },
      { type: 'handover', operation: { type: 'cancel', handoverId: 'handover' } },
    ])
  })
  it('does not expose a completed target to an abandoned composer', async () => {
    const abort = new AbortController()
    await expect(ensurePptProSession(source, 'handover', async () => {
      abort.abort()
      return { records: [record('applied', { targetSessionId: 'pro-target' })] }
    }, abort.signal)).rejects.toThrow()
  })
})
