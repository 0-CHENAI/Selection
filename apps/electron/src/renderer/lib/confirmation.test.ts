import { describe, expect, test } from 'bun:test'
import { createConfirmationController, type ConfirmationRequest } from './confirmation'

const request: ConfirmationRequest = { title: 'Delete', message: 'Delete 3 sessions?', confirmLabel: 'Delete', cancelLabel: 'Cancel', destructive: true, returnFocus: null }
describe('application confirmations', () => {
  test('requires a mounted host and rejects concurrent requests', async () => {
    const controller = createConfirmationController()
    expect(await controller.request(request)).toBe(false)
    const unmount = controller.subscribe(() => {})
    const first = controller.request(request)
    expect(await controller.request(request)).toBe(false)
    expect(controller.getSnapshot()?.message).toBe(request.message)
    controller.settle(false)
    expect(await first).toBe(false)
    unmount()
  })
  test('cancel and host teardown cannot execute the operation; approval executes once', async () => {
    const controller = createConfirmationController()
    const unmount = controller.subscribe(() => {})
    let deletes = 0
    const perform = async () => { if (await controller.request(request)) deletes++ }
    const cancelled = perform()
    controller.settle(false)
    await cancelled
    const approved = perform()
    controller.settle(true)
    controller.settle(true)
    await approved
    const interrupted = perform()
    unmount()
    await interrupted
    expect(deletes).toBe(1)
  })
})
