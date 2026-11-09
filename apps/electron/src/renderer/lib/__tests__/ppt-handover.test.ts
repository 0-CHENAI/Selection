import { describe, expect, it } from 'bun:test'
import type { SessionCommand } from '@craft-agent/shared/protocol'
import type { Session } from '../../../shared/types'
import { ensurePptProSession } from '../ppt-handover'

const source: Session = { id: 'ordinary', workMode: 'NORM', workspaceId: 'ws', workspaceName: 'Workspace', messages: [], isProcessing: false, lastMessageAt: 0 }

describe('PPT stays on the same conversation', () => {
  it('switches the current session to PRO without creating a target', async () => {
    const commands: SessionCommand[] = []
    const target = await ensurePptProSession(source, async (id, command) => {
      commands.push(command)
      expect(id).toBe(source.id)
    }, new AbortController().signal)
    expect(target).toBe(source.id)
    expect(commands).toEqual([{ type: 'setWorkMode', mode: 'PRO' }])
  })
  it('skips the switch when the conversation is already PRO', async () => {
    const commands: SessionCommand[] = []
    const session = { ...source, workMode: 'PRO' as const }
    const target = await ensurePptProSession(session, async (_id, command) => { commands.push(command) }, new AbortController().signal)
    expect(target).toBe(session.id)
    expect(commands).toEqual([])
  })
  it('does not expose a completed target to an abandoned composer', async () => {
    const abort = new AbortController()
    await expect(ensurePptProSession(source, async () => {
      abort.abort()
    }, abort.signal)).rejects.toThrow()
  })
})
