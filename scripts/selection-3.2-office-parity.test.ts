import { expect, test } from 'bun:test'
import { evidenceProblems } from './selection-3.2-office-parity.ts'
import { PARITY_ITEMS, scoreParity } from './office-parity/matrix.ts'

test('parity evidence exists and every counted domain is at least 90%', () => {
  expect(evidenceProblems()).toEqual([])
  const score = scoreParity()
  for (const domain of score.domains) {
    expect(domain.percent).toBeGreaterThanOrEqual(90)
    expect(domain.missing).toBe(0)
  }
  expect(score.overall.percent).toBeGreaterThanOrEqual(90)
  expect(PARITY_ITEMS.filter(item => item.status === 'excluded').every(item => item.reason)).toBe(true)
  expect(PARITY_ITEMS.filter(item => item.status === 'partial').every(item => item.reason)).toBe(true)
})
