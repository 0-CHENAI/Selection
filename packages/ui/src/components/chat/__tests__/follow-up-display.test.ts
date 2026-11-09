import { describe, expect, it } from 'bun:test'
import { localizeFollowUpSectionHeading } from '../follow-up-display'
import { getUserMessageCopyText } from '../visible-user-message-text'

const section = [
  '请看这段',
  '',
  '---',
  '',
  '**Follow-ups**',
  '',
  '> [#1] yuzeguitarist/deck/deckclip',
  '→ 可是我现在没有安装deck，这个要删除么?',
].join('\n')

describe('follow-up section heading localization', () => {
  it('replaces the canonical English heading and the legacy marker', () => {
    expect(localizeFollowUpSectionHeading(section, '追问')).toContain('**追问**')
    expect(localizeFollowUpSectionHeading(section, '追问')).not.toContain('Follow-ups')
    expect(localizeFollowUpSectionHeading(section, '追问')).toContain('> [#1] yuzeguitarist/deck/deckclip')
    expect(localizeFollowUpSectionHeading(section, '追问')).toContain('→ 可是我现在没有安装deck，这个要删除么?')
    expect(localizeFollowUpSectionHeading('Follow-up annotations:\n\n> [#1] quote\n→ note', '追问')).toBe('追问\n\n> [#1] quote\n→ note')
  })

  it('keeps the English heading when the locale label is Follow-ups', () => {
    expect(localizeFollowUpSectionHeading(section, 'Follow-ups')).toBe(section)
  })

  it('leaves ordinary messages unchanged', () => {
    expect(localizeFollowUpSectionHeading('Follow up tomorrow', '追问')).toBe('Follow up tomorrow')
  })

  it('localizes the copied plain-text heading without changing the quote', () => {
    expect(getUserMessageCopyText(section, [], '追问')).toContain('追问')
    expect(getUserMessageCopyText(section, [], '追问')).not.toContain('Follow-ups')
    expect(getUserMessageCopyText(section, [], '追问')).toContain('[#1] yuzeguitarist/deck/deckclip')
    expect(getUserMessageCopyText(section, [], 'Follow-ups')).toContain('Follow-ups')
  })
})
