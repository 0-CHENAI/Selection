import type { WeixinLoginRequest, WeixinLoginResult } from '@craft-agent/shared/protocol'
import { WEIXIN_BASE, weixinOrigin, weixinRequest, type WeixinAccount } from './api'

interface Attempt {
  id: string
  qr?: string
  base: string
  expires: number
  controller: AbortController
  codesIssued: number
  pin?: string
  polling: boolean
}

export class WeixinLogin {
  private pending?: Attempt

  cancel(id?: string) {
    if (id && this.pending?.id !== id) return
    this.pending?.controller.abort()
    this.pending = undefined
  }

  private async issueQr(attempt: Attempt, localTokens: () => Promise<string[]>): Promise<WeixinLoginResult> {
    const tokens = await localTokens()
    if (this.pending !== attempt) return { status: 'cancelled' }
    const qr = await weixinRequest<{ qrcode: string; qrcode_img_content: string }>(WEIXIN_BASE, 'get_bot_qrcode?bot_type=3', {
      body: { local_token_list: tokens }, signal: attempt.controller.signal,
    })
    if (this.pending !== attempt) return { status: 'cancelled' }
    if (!qr.qrcode || !qr.qrcode_img_content) throw new Error('WeChat returned no QR code')
    attempt.qr = qr.qrcode
    attempt.base = WEIXIN_BASE
    attempt.pin = undefined
    attempt.codesIssued++
    return { status: 'qr', content: qr.qrcode_img_content }
  }

  async handle(req: WeixinLoginRequest, connect: (account: WeixinAccount) => Promise<void>,
    localTokens: () => Promise<string[]> = async () => []): Promise<WeixinLoginResult> {
    if (!req || typeof req.attempt !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(req.attempt)) throw new Error('Invalid login attempt')
    if (req.action === 'cancel') {
      this.cancel(req.attempt)
      return { status: 'cancelled' }
    }
    if (req.action === 'start') {
      this.cancel()
      const attempt: Attempt = { id: req.attempt, base: WEIXIN_BASE, expires: Date.now() + 480_000, codesIssued: 0, controller: new AbortController(), polling: false }
      this.pending = attempt
      return this.issueQr(attempt, localTokens)
    }
    if (req.action !== 'poll') throw new Error('Invalid login action')
    const attempt = this.pending
    if (!attempt?.qr || attempt.id !== req.attempt || Date.now() >= attempt.expires) return { status: 'expired' }
    if (attempt.polling) return { status: 'waiting' }
    const query = new URLSearchParams({ qrcode: attempt.qr })
    if (req.pin) {
      if (!/^\d+$/.test(req.pin)) throw new Error('Invalid PIN')
      attempt.pin = req.pin
    }
    if (attempt.pin) query.set('verify_code', attempt.pin)
    attempt.polling = true
    try {
      const result = await weixinRequest<{ status: string; bot_token?: string; baseurl?: string; ilink_bot_id?: string; ilink_user_id?: string; redirect_host?: string }>(
        attempt.base, 'get_qrcode_status?' + query, { signal: attempt.controller.signal, timeoutMs: 35_000 },
      ).catch(() => ({ status: 'wait' } as const))
      if (this.pending !== attempt) return { status: 'cancelled' }
      if (result.status === 'scaned') attempt.pin = undefined
      if (result.status === 'confirmed') {
        if (!result.bot_token || !result.ilink_bot_id) throw new Error('Incomplete WeChat account')
        await connect({ token: result.bot_token, botId: result.ilink_bot_id, userId: result.ilink_user_id,
          baseUrl: weixinOrigin(result.baseurl || WEIXIN_BASE) })
        this.cancel(attempt.id)
        return { status: 'connected' }
      }
      if (result.status?.includes('need_verifycode')) return { status: 'pin' }
      if (result.status === 'binded_redirect') {
        this.cancel(attempt.id)
        return { status: 'already_bound' }
      }
      if (result.status === 'expired' || result.status === 'verify_code_blocked') {
        if (attempt.codesIssued < 3) return await this.issueQr(attempt, localTokens)
        this.cancel(attempt.id)
        return { status: 'expired' }
      }
      if (result.status === 'scaned_but_redirect' && result.redirect_host) attempt.base = weixinOrigin('https://' + result.redirect_host)
      return { status: 'waiting' }
    } catch (error) {
      if (this.pending !== attempt) return { status: 'cancelled' }
      throw error
    } finally { attempt.polling = false }
  }
}
