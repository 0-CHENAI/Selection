import { expect, test } from 'bun:test'
import {
  OFFICE_FOLLOW_UP_ATTACHMENT_CONFLICT,
  directedOfficeElements,
  officeSelectionAttachmentConflict,
} from '../office-follow-up'

const selected = { elements: [{ path: '/slide[1]/shape[1]' }] }

test('a PPT follow-up with no Office selection can carry images and files', () => {
  expect(directedOfficeElements(undefined)).toBe(0)
  expect(directedOfficeElements({ elements: [] })).toBe(0)
  expect(officeSelectionAttachmentConflict(undefined, 2, 0)).toBe(false)
  expect(officeSelectionAttachmentConflict({ elements: [] }, 1, 1)).toBe(false)
})

test('a real Office selection cannot be sent together with attachments', () => {
  expect(officeSelectionAttachmentConflict(selected, 1, 0)).toBe(true)
  expect(officeSelectionAttachmentConflict(selected, 0, 1)).toBe(true)
  expect(officeSelectionAttachmentConflict(selected, 0, 0)).toBe(false)
  expect(OFFICE_FOLLOW_UP_ATTACHMENT_CONFLICT).toContain('取消选择')
  expect(OFFICE_FOLLOW_UP_ATTACHMENT_CONFLICT).toContain('图片')
})
