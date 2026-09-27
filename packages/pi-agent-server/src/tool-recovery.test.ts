import { expect, test } from 'bun:test'
import { registerRecoveryClass, registeredRecoveryClass } from './tool-recovery'

test('recovery contracts belong to implementations, not names or supplied metadata', () => {
  const native = registerRecoveryClass({ name: 'read' }, 'read-only')
  expect(registeredRecoveryClass(native)).toBe('read-only')
  expect(registeredRecoveryClass({ name: 'read' })).toBe('unknown')
  expect(registeredRecoveryClass({ ...native, recoveryClass: 'read-only' })).toBe('unknown')
  const write = registerRecoveryClass({ name: 'write' }, 'file-verifiable')
  expect(registeredRecoveryClass(write)).toBe('file-verifiable')
})
