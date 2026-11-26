import { describe, expect, it } from 'bun:test'
import { REQUEST_TIMEOUT_MS, requestTimeoutMsForChannel } from '../types.ts'

describe('requestTimeoutMsForChannel', () => {
  it('keeps the default deadline for ordinary RPCs', () => {
    expect(requestTimeoutMsForChannel('sessions:get')).toBe(REQUEST_TIMEOUT_MS)
    expect(requestTimeoutMsForChannel('system:homeDir')).toBe(REQUEST_TIMEOUT_MS)
  })

  it('allows the WeChat login poll and QR refresh to finish within one RPC', () => {
    expect(requestTimeoutMsForChannel('messaging:weixinLogin', 5_000)).toBe(60_000)
    expect(requestTimeoutMsForChannel('messaging:weixinLogin', 90_000)).toBe(90_000)
    expect(requestTimeoutMsForChannel('sessions:get', 5_000)).toBe(5_000)
  })

  it('does not time out native pickers or confirmations', () => {
    expect(requestTimeoutMsForChannel('dialog:openFolder')).toBeNull()
    expect(requestTimeoutMsForChannel('file:openDialog')).toBeNull()
    expect(requestTimeoutMsForChannel('gitbash:browse')).toBeNull()
    expect(requestTimeoutMsForChannel('auth:showLogoutConfirmation')).toBeNull()
    expect(requestTimeoutMsForChannel('auth:showDeleteSessionConfirmation')).toBeNull()
    expect(requestTimeoutMsForChannel('client:openFileDialog')).toBeNull()
    expect(requestTimeoutMsForChannel('client:confirmDialog')).toBeNull()
  })
})
