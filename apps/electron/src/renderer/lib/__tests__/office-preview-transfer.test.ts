import { expect, test } from 'bun:test'
import { filesFromOfficePreviewPaste, OFFICE_PREVIEW_PASTE_MAX_BYTES } from '../office-preview-transfer'

test('files pasted onto an open Office preview become composer attachments', () => {
  const png = new Uint8Array([137, 80, 78, 71])
  const text = new TextEncoder().encode('agenda')
  const result = filesFromOfficePreviewPaste({
    files: [
      { name: 'folder/extra.png', type: 'image/png', buffer: png.buffer },
      { name: 'notes.txt', type: 'text/plain', buffer: text.buffer },
      { name: '../secret.txt', type: 'text/plain', buffer: text.buffer },
    ],
    rejected: [{ name: 'huge.pdf', size: OFFICE_PREVIEW_PASTE_MAX_BYTES + 1 }],
  })
  expect(result.files.map(file => [file.name, file.type.replace(/;.*$/, ''), file.size])).toEqual([
    ['extra.png', 'image/png', png.byteLength],
    ['notes.txt', 'text/plain', text.byteLength],
    ['secret.txt', 'text/plain', text.byteLength],
  ])
  expect(result.rejected).toEqual([{ name: 'huge.pdf', size: OFFICE_PREVIEW_PASTE_MAX_BYTES + 1 }])
})

test('a preview paste payload cannot invent paths or empty files', () => {
  expect(filesFromOfficePreviewPaste({ files: [{ name: '..', buffer: new Uint8Array([1]).buffer }] }).files).toEqual([])
  expect(filesFromOfficePreviewPaste(null).files).toEqual([])
})
