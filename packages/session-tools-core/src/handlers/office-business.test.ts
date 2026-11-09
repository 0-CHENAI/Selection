import { expect, test } from 'bun:test'
import type { SessionToolContext } from '../context.ts'
import { SESSION_TOOL_REGISTRY } from '../tool-defs.ts'
import { handleOfficeBusiness } from './office-business.ts'

test('office_business is registered and rejects a call without the host', async () => {
  const def = SESSION_TOOL_REGISTRY.get('office_business')
  expect(def?.executionMode).toBe('registry')
  const missing = await handleOfficeBusiness({} as unknown as SessionToolContext, { command: 'metrics', mrr: 1 })
  expect(missing.isError).toBe(true)
  expect(missing.content[0]?.text).toContain('不可用')
})

test('office_business returns the host result', async () => {
  const result = await handleOfficeBusiness({
    officeBusiness: async () => ({ command: 'metrics', exitCode: 0, stdout: '{"MRR": 1}\n', stderr: '' }),
  } as unknown as SessionToolContext, { command: 'metrics', mrr: 1 })
  expect(result.isError).toBeFalsy()
  expect(result.content[0]?.text).toContain('metrics')
  expect(result.content[0]?.text).toContain('MRR')
})
