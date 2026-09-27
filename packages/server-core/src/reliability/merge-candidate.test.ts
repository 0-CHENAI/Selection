import { expect, test } from 'bun:test'
import { mergeCandidate } from './merge-candidate'
const b = (value: string) => Buffer.from(value)
test('independent text changes merge without losing either agent output', () => {
  const result = mergeCandidate(b('one\ntwo\nthree\nfour\nfive\n'), b('ONE\ntwo\nthree\nfour\nfive\n'), b('one\ntwo\nthree\nfour\nFIVE\n'))
  expect(result.status).toBe('merged')
  if (result.status === 'merged') expect(result.content.toString()).toBe('ONE\ntwo\nthree\nfour\nFIVE\n')
})
test('overlapping edits remain conflicts with the untouched candidate and target', () => {
  const current = b('user edit\n'), candidate = b('agent edit\n')
  expect(mergeCandidate(b('base\n'), current, candidate)).toEqual({ status: 'conflict', reason: 'text', current, candidate })
})
test('binary divergence and delete/modify conflicts are never silently merged', () => {
  const base = Buffer.from([0,1]), current = Buffer.from([0,2]), candidate = Buffer.from([0,3])
  expect(mergeCandidate(base, current, candidate).status).toBe('conflict')
  expect(mergeCandidate(base, base, candidate)).toEqual({ status: 'merged', content: candidate, changed: true })
  expect(mergeCandidate(b('base'), b('edited'), null).status).toBe('conflict')
  expect(mergeCandidate(null, b('user-created'), b('agent-created')).status).toBe('conflict')
})
test('repeated delivery is a no-op and unchanged candidates preserve external work', () => {
  expect(mergeCandidate(b('base'), b('new'), b('new'))).toEqual({ status: 'merged', content: b('new'), changed: false })
  expect(mergeCandidate(b('base'), b('user'), b('base'))).toEqual({ status: 'merged', content: b('user'), changed: false })
  expect(mergeCandidate(b('base'), b('base'), null)).toEqual({ status: 'deleted', changed: true })
})
test('declared binary formats cannot be merged just because their bytes happen to be UTF-8', () => {
  expect(mergeCandidate(b('one\ntwo\nthree\n'), b('ONE\ntwo\nthree\n'), b('one\ntwo\nTHREE\n'), { binary: true })).toMatchObject({ status: 'conflict', reason: 'binary' })
})
