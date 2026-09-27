import { expect, test } from 'bun:test'
import { workspaceDeliveryContract } from './workspace-delivery-contract'

test('delivery freezes declared paths independently of model input objects', () => {
  const inputs = ['./source.txt', 'source.txt']
  const outputs = { document: 'docs\\result.txt' }
  const contract = workspaceDeliveryContract(inputs, outputs)
  inputs.push('later.txt'); outputs.document = 'other.txt'
  expect(contract).toEqual({ version: 1, inputs: ['source.txt'], outputs: { document: 'docs/result.txt' } })
})

test('delivery rejects cross-platform escapes and ambiguous output identities', () => {
  for (const path of ['/tmp/a', 'C:\\a', 'C:a', '\\\\server\\share\\a', '../a', 'dir/../../a', '.git/config', '.', 'dir/', 'a\0b']) {
    expect(() => workspaceDeliveryContract([], { result: path })).toThrow()
  }
  expect(() => workspaceDeliveryContract([], {})).toThrow()
  expect(() => workspaceDeliveryContract([], { a: 'Result.txt', b: 'result.txt' })).toThrow('duplicate')
  expect(() => workspaceDeliveryContract(['../secret'], { a: 'result.txt' })).toThrow()
})
