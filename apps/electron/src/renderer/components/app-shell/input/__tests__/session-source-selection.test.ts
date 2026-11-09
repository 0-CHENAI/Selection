import { expect, test } from 'bun:test'
import { reconcileSessionSourceSelection } from '../session-source-selection'

test('standalone composers without session IDs initialize normally', () => {
  expect(reconcileSessionSourceSelection(undefined, undefined, []).slugs).toEqual([])
})

test('switching to an empty session discards an unacknowledged optimistic selection', () => {
  const a = { ...reconcileSessionSourceSelection(undefined, 'a', []), slugs: ['database'] }
  // Both sessions have the same confirmed []: content comparison alone misses the switch.
  expect(reconcileSessionSourceSelection(a, 'b', []).slugs).toEqual([])
  expect(reconcileSessionSourceSelection(a, '__draft__:ws', []).slugs).toEqual([])
  expect(a.slugs).toEqual(['database'])
})

test('keeps same-session optimism until confirmed values change, then restores each session', () => {
  const a = { ...reconcileSessionSourceSelection(undefined, 'a', ['old']), slugs: ['new'] }
  expect(reconcileSessionSourceSelection(a, 'a', ['old'])).toBe(a)
  const confirmed = reconcileSessionSourceSelection(a, 'a', ['new'])
  const b = reconcileSessionSourceSelection(confirmed, 'b', ['other'])
  expect(b.slugs).toEqual(['other'])
  expect(reconcileSessionSourceSelection(b, 'a', ['new']).slugs).toEqual(['new'])
  expect(reconcileSessionSourceSelection(b, 'b', []).slugs).toEqual([])
})
