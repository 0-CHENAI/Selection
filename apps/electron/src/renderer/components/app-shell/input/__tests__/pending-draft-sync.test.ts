import { describe, expect, it } from 'bun:test'
import { createPendingDraftSync } from '../pending-draft-sync'

describe('pending draft persistence', () => {
  it('does not resurrect an accepted prompt when navigation unmounts the sender', () => {
    let draft = ''
    const sync = createPendingDraftSync(text => { draft = text })
    sync.schedule('research request')
    sync.flush() // send begins; onSubmit may navigate before it resolves
    expect(draft).toBe('research request')
    draft = '' // ChatPage accepts the send and consumes the draft
    sync.flush() // old composer unmounts with the sent text still in React state
    expect(draft).toBe('')
    sync.flush() // revisiting the mode cannot restore that stale text
    expect(draft).toBe('')
  })

  it('keeps an unaccepted send available as a draft', () => {
    let draft = ''
    const sync = createPendingDraftSync(text => { draft = text })
    sync.schedule('retry me')
    sync.flush()
    sync.flush() // navigation after rejection
    expect(draft).toBe('retry me')
  })

  it('flushes the latest unsaved edit only to its original mode', () => {
    const drafts = { NORM: '', PRO: '' }
    const pro = createPendingDraftSync(text => { drafts.PRO = text })
    const norm = createPendingDraftSync(text => { drafts.NORM = text })
    pro.schedule('first')
    pro.schedule('latest')
    pro.flush()
    norm.schedule('normal draft')
    norm.flush()
    expect(drafts).toEqual({ NORM: 'normal draft', PRO: 'latest' })
  })

  it('persists deletion and cancels edits explicitly cleared by the composer', () => {
    const writes: string[] = []
    const sync = createPendingDraftSync(text => writes.push(text))
    sync.schedule('discard')
    sync.cancel()
    sync.flush()
    expect(writes).toEqual([])
    sync.schedule('')
    sync.flush()
    expect(writes).toEqual([''])
  })

  it('does not flush an already debounced edit again after the parent clears it', async () => {
    const writes: string[] = []
    const sync = createPendingDraftSync(text => writes.push(text), 1)
    sync.schedule('sent')
    await new Promise(resolve => setTimeout(resolve, 10))
    sync.flush()
    expect(writes).toEqual(['sent'])
  })
})
