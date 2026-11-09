import { expect, test } from 'bun:test'
import { clipboardFiles, clipboardHasFiles } from '../clipboard-files'

test('PPT and chat paste accept a screenshot that is only on clipboard items', () => {
  const image = new File([Uint8Array.from([1, 2, 3, 4])], 'image.png', { type: 'image/png' })
  const note = new File([Uint8Array.from([5, 6])], 'notes.txt', { type: 'text/plain' })
  expect(clipboardFiles({ files: [], items: [
    { kind: 'string', getAsFile: () => null },
    { kind: 'file', getAsFile: () => image },
  ] })).toEqual([image])
  expect(clipboardFiles({ files: [note], items: [{ kind: 'file', getAsFile: () => image }] })).toEqual([note])
  expect(clipboardFiles(null)).toEqual([])
  expect(clipboardHasFiles({ files: [], items: [{ kind: 'file' }] })).toBe(true)
  expect(clipboardHasFiles({ files: [], items: [{ kind: 'string' }] })).toBe(false)
})
