import { describe, expect, test } from 'bun:test'
import { createConfirmationBridge } from './confirmation-bridge'

const spec = { title: 'Delete', message: 'Delete?', buttons: ['Cancel', 'Delete'], cancelId: 0 }
describe('client confirmation bridge', () => {
  test('missing renderer, errors and invalid responses never approve', async () => {
    const bridge = createConfirmationBridge()
    expect(await bridge.request(spec)).toEqual({ response: 0 })
    bridge.register(async () => { throw new Error('unmounted') })
    expect(await bridge.request(spec)).toEqual({ response: 0 })
    bridge.register(async () => ({ response: 99 }))
    expect(await bridge.request(spec)).toEqual({ response: 0 })
  })
  test('duplicates cancel and unmount settles the outstanding server request', async () => {
    const bridge = createConfirmationBridge()
    let reply!: (result: { response: number }) => void
    const unmount = bridge.register(() => new Promise(resolve => { reply = resolve }))
    const first = bridge.request(spec)
    await Promise.resolve()
    expect(await bridge.request(spec)).toEqual({ response: 0 })
    unmount()
    expect(await first).toEqual({ response: 0 })
    reply({ response: 1 })
    expect(await bridge.request(spec)).toEqual({ response: 0 })
  })
  test('a valid active renderer approval is delivered once', async () => {
    const bridge = createConfirmationBridge()
    bridge.register(async received => { expect(received).toEqual(spec); return { response: 1 } })
    expect(await bridge.request(spec)).toEqual({ response: 1 })
  })
})
