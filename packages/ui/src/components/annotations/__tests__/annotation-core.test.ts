import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import {
  createSelectionPreviewAnnotation,
  createTextSelectionAnnotation,
  hashAnnotationSource,
  hasExistingTextRangeAnnotation,
} from '../annotation-core'
import { getAnnotationChipVisual } from '../annotation-style-tokens'

describe('annotation core helpers', () => {
  it('creates text selection annotation with follow-up metadata and session id', () => {
    const annotation = createTextSelectionAnnotation(
      'msg-1',
      {
        start: 2,
        end: 9,
        selectedText: 'example',
        prefix: 'pre',
        suffix: 'suf',
      },
      'Need follow-up',
      'session-42',
    )

    expect(annotation.target.source).toEqual({
      sessionId: 'session-42',
      messageId: 'msg-1',
    })

    const noteBody = annotation.body.find(body => body.type === 'note')
    expect(noteBody && 'text' in noteBody ? noteBody.text : '').toBe('Need follow-up')

    const followUp = (annotation.meta as Record<string, unknown> | undefined)?.followUp as Record<string, unknown> | undefined
    expect(followUp?.text).toBe('Need follow-up')
    expect(typeof followUp?.createdAt).toBe('number')
  })

  it('creates preview annotation marked ephemeral with explicit source', () => {
    const preview = createSelectionPreviewAnnotation(
      'msg-2',
      {
        start: 0,
        end: 4,
        selectedText: 'test',
        prefix: '',
        suffix: ' data',
      },
      'session-preview',
    )

    expect(preview.target.source).toEqual({ sessionId: 'session-preview', messageId: 'msg-2' })
    expect((preview.meta as Record<string, unknown>)?.ephemeral).toBe(true)
    expect((preview.meta as Record<string, unknown>)?.source).toBe('follow-up-selection-preview')
  })

  it('keeps chip visuals consistent across pending and sent states', () => {
    const pending = getAnnotationChipVisual({ pendingFollowUp: true, sentFollowUp: false })
    const sent = getAnnotationChipVisual({ pendingFollowUp: false, sentFollowUp: true })

    expect(pending.className.includes('shadow-tinted')).toBe(true)
    expect(String(pending.style.backgroundColor)).toContain('34%')
    expect(String(sent.style.backgroundColor)).toContain('14%')
  })
  it('hashes the raw source consistently with the runtime without normalizing line endings', async () => {
    const content = '# 标题\r\n**正文** 😀'
    expect(await hashAnnotationSource(content)).toBe(createHash('sha256').update(content).digest('hex'))
    expect(await hashAnnotationSource(content)).not.toBe(await hashAnnotationSource(content.replaceAll('\r\n', '\n')))
  })

  it('allows explicit reselection at the same rendered range when its source version changed', () => {
    const annotation = createTextSelectionAnnotation('msg', {
      start: 0, end: 4, selectedText: 'test', prefix: '', suffix: '',
    }, 'Revise')
    annotation.meta = { ...annotation.meta, sourceContentHash: 'old' }
    expect(hasExistingTextRangeAnnotation([annotation], 0, 4, 'old')).toBe(true)
    expect(hasExistingTextRangeAnnotation([annotation], 0, 4, 'new')).toBe(false)
    const legacy = { ...annotation, meta: undefined }
    expect(hasExistingTextRangeAnnotation([legacy], 0, 4, 'new')).toBe(true)
  })

})
