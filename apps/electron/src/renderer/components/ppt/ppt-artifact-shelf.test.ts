import { beforeAll, expect, mock, test } from 'bun:test'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let messageShelfAnchors: typeof import('./ppt-artifact-shelf').messageShelfAnchors
let pptSessionAnchor: typeof import('./ppt-artifact-shelf').pptSessionAnchor
let pptShelfTarget: typeof import('./ppt-artifact-shelf').pptShelfTarget

beforeAll(async () => {
  ;({ messageShelfAnchors, pptSessionAnchor, pptShelfTarget } = await import('./ppt-artifact-shelf'))
})

test('a delivered pptx stays on the message that listed it', () => {
  const messages = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant', turnId: 't1', answerRunId: 'run-1' },
    { id: 'a2', role: 'assistant', turnId: 't2', artifactVersions: [{ path: 'C:\\Decks\\项目介绍.PPTX' }] },
  ]
  const target = pptShelfTarget('sess', messages, 'c:/decks/项目介绍.pptx')
  expect(target.listed).toBe(true)
  expect(target.anchors).toEqual(messageShelfAnchors('sess', messages[2]!))
  expect(target.anchors).toContain('a2')
  expect(target.anchors).toContain('sess:t2:t2')
})

test('generation before a file exists uses the latest assistant message', () => {
  const messages = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant', turnId: 't1', isIntermediate: true },
  ]
  expect(pptShelfTarget('sess', messages, undefined)).toEqual({
    anchors: messageShelfAnchors('sess', messages[1]!),
    listed: false,
  })
  expect(pptShelfTarget('sess', [{ id: 'u1', role: 'user' }], undefined)).toEqual({ anchors: [], listed: false })
  expect(pptSessionAnchor('sess')).toBe('ppt-session:sess')
})
