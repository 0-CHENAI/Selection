export interface WeixinLoginRequest {
  action: 'start' | 'poll' | 'cancel'
  attempt: string
  pin?: string
}

export type WeixinLoginResult =
  | { status: 'qr'; content: string }
  | { status: 'waiting' | 'pin' | 'already_bound' | 'expired' | 'connected' | 'cancelled' }
