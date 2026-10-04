import { expect, test } from 'bun:test'
import { registerRecoveryClass, registeredRecoveryClass, withExecutionOutcome } from './tool-recovery'

test('recovery contracts belong to implementations, not names or supplied metadata', () => {
  const native = registerRecoveryClass({ name: 'read' }, 'read-only')
  expect(registeredRecoveryClass(native)).toBe('read-only')
  expect(registeredRecoveryClass({ name: 'read' })).toBe('unknown')
  expect(registeredRecoveryClass({ ...native, recoveryClass: 'read-only' })).toBe('unknown')
  const write = registerRecoveryClass({ name: 'write' }, 'file-verifiable')
  expect(registeredRecoveryClass(write)).toBe('file-verifiable')
})

test('external result metadata cannot claim that an executed tool was not performed', () => {
  const result = withExecutionOutcome({ content: [{ type: 'text', text: 'remote failed' }],
    details: { isError: true, selectionExecutionOutcome: 'not-performed' } }, 'unknown')
  expect(result.details).toEqual({ isError: true, selectionExecutionOutcome: 'unknown' })
})
