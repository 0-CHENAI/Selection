import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { SessionCompletionEvent } from '@craft-agent/server-core/sessions'
import { resolveQuote, type StoredQuote } from '../adapters/weixin/quotes'
import { createMessagingBootstrap } from '../bootstrap'
import { weixinRequest, WEIXIN_BASE } from '../adapters/weixin/api'
import { WeixinAdapter } from '../adapters/weixin'
import { WeixinSessionPicker, weixinSessionTitle } from '../adapters/weixin/session-picker'
import type { Session } from '@craft-agent/shared/protocol'
import { buildClarificationState, type ClarificationResponseInput } from '@craft-agent/shared/agent/clarification'
import { parseWeixinAnswers } from '../adapters/weixin/clarifications'
import { WeixinLogin } from '../adapters/weixin/login'

const network: { fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> } = globalThis
afterEach(() => mock.restore())

async function waitUntil(check: () => boolean) {
  const end = Date.now() + 3000
  while (!check() && Date.now() < end) await Bun.sleep(10)
  expect(check()).toBe(true)
}

describe('personal WeChat', () => {
  it('preserves wire uint64 identifiers and sends the pinned official version headers', async () => {
    const wire = '{"message_id":18446744073709551615,"other":{"msg_id":9007199254740993,"svr_id":9007199254740992},"text":"18446744073709551615"}'
    const fetch = spyOn(network, 'fetch').mockResolvedValueOnce(new Response(wire))
    const result = await weixinRequest(WEIXIN_BASE, 'getupdates', { token: 'token', body: { get_updates_buf: '' } })
    expect(result).toEqual({ message_id: '18446744073709551615', other: { msg_id: '9007199254740993', svr_id: '9007199254740992' }, text: '18446744073709551615' })
    const init = fetch.mock.calls[0]![1]!
    expect(init.headers).toMatchObject({ 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String(0x02040a), Authorization: 'Bearer token' })
    expect(JSON.parse(String(init.body)).base_info).toMatchObject({ channel_version: '2.4.10' })
  })

  it('resolves exact quotes within the sender and refuses ambiguous or stale references', () => {
    const a: StoredQuote = { peer: 'owner', sessionId: 'A', kind: 'answer', text: '相同的回复' }
    const b: StoredQuote = { ...a, sessionId: 'B', serverId: '123' }
    const records = [a, b]
    expect(resolveQuote(records, 'owner', { svr_id: '123' })).toEqual(b)
    expect(resolveQuote(records, 'owner', { title: a.text })).toBeUndefined()
    expect(resolveQuote(records, 'owner', { svr_id: '456', title: a.text })).toBeUndefined()
    expect(resolveQuote(records, 'other', { svr_id: '123' })).toBeUndefined()
  })

  it('uses the project display name and distinguishes regular chats with the same name', () => {
    const session = { workspaceId: 'ws', id: 'session-id', name: '日常问候' }
    const projects = () => [{ id: 'stable-id', name: 'Selection' }]
    expect(weixinSessionTitle({ ...session, projectId: 'stable-id' }, projects)).toBe('Selection / 日常问候')
    expect(weixinSessionTitle(session, projects)).toBe('普通会话 / 日常问候')
  })

  it('keeps the PIN across transient poll failures and clears it after acceptance', async () => {
    const login = new WeixinLogin()
    const fetch = spyOn(network, 'fetch')
      .mockResolvedValueOnce(Response.json({ qrcode: 'qr', qrcode_img_content: 'display' }))
      .mockResolvedValueOnce(Response.json({ status: 'need_verifycode' }))
      .mockResolvedValueOnce(new Response('', { status: 524 }))
      .mockResolvedValueOnce(Response.json({ status: 'scaned' }))
      .mockResolvedValueOnce(Response.json({ status: 'binded_redirect' }))
    const connect = mock(async () => {})
    const attempt = 'recover'
    await login.handle({ action: 'start', attempt }, connect, async () => ['saved'])
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ local_token_list: ['saved'] })
    const poll = { action: 'poll', attempt } as const
    expect(await login.handle(poll, connect)).toEqual({ status: 'pin' })
    expect(await login.handle({ ...poll, pin: '0123' }, connect)).toEqual({ status: 'waiting' })
    expect(await login.handle(poll, connect)).toEqual({ status: 'waiting' })
    expect(await login.handle(poll, connect)).toEqual({ status: 'already_bound' })
    expect(fetch.mock.calls.slice(1).map(([url]) => new URL(String(url)).searchParams.get('verify_code')))
      .toEqual([null, '0123', '0123', null])
    expect(connect).not.toHaveBeenCalled()
  })

  it('refreshes expired or locked QR codes at most twice per attempt', async () => {
    const login = new WeixinLogin()
    let count = 0
    spyOn(network, 'fetch').mockImplementation(async url => {
      if (String(url).includes('get_bot_qrcode')) {
        count++
        return Response.json({ qrcode: String(count), qrcode_img_content: 'qr' + count })
      }
      return Response.json({ status: count === 2 ? 'verify_code_blocked' : 'expired' })
    })
    const connect = mock(async () => {})
    const attempt = 'refresh'
    expect(await login.handle({ action: 'start', attempt }, connect)).toEqual({ status: 'qr', content: 'qr1' })
    for (const content of ['qr2', 'qr3']) {
      expect(await login.handle({ action: 'poll', attempt }, connect)).toEqual({ status: 'qr', content })
    }
    expect(await login.handle({ action: 'poll', attempt }, connect)).toEqual({ status: 'expired' })
    expect(count).toBe(3)
  })

  it('pauses the account on -14 even when the other error field is nonzero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-weixin-pause-'))
    const notify = mock(() => {})
    const adapter = new WeixinAdapter({ botId: 'b', userId: 'u', token: 't', baseUrl: WEIXIN_BASE }, dir, notify, () => 'u')
    const endpoints: string[] = []
    spyOn(network, 'fetch').mockImplementation(async url => {
      const path = new URL(String(url)).pathname
      endpoints.push(path)
      return Response.json(path.endsWith('getupdates') ? { ret: -14, errcode: 1 } : { ret: 0 })
    })
    try {
      await adapter.initialize()
      adapter.onMessage(async () => {})
      await waitUntil(() => !adapter.isConnected())
      expect(notify).toHaveBeenCalledWith('connecting')
      await expect(adapter.sendText('ignored', 'text')).rejects.toThrow('unavailable')
    } finally {
      await adapter.destroy()
      rmSync(dir, { recursive: true, force: true })
    }
    expect(endpoints).toEqual(['/ilink/bot/msg/notifystart', '/ilink/bot/getupdates'])
  })

  it('preserves a confirmed outbound quote across graceful shutdown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-weixin-drain-'))
    const account = { botId: 'b', userId: 'owner', token: 't', baseUrl: WEIXIN_BASE }
    const make = () => new WeixinAdapter(account, dir, () => {}, () => account.userId)
    const adapter = make()
    const restarted = make()
    const response = Promise.withResolvers<Response>()
    const received = mock(async (_msg: unknown) => {})
    let firstPoll = true
    spyOn(network, 'fetch').mockImplementation(async url => {
      const path = new URL(String(url)).pathname
      if (path.endsWith('/sendmessage')) return response.promise
      if (firstPoll && path.endsWith('/getupdates')) {
        firstPoll = false
        return Response.json({ msgs: [{ from_user_id: 'owner', message_type: 1, message_id: 'q',
          item_list: [{ type: 1, text_item: { text: '继续' }, ref_msg: { svr_id: '987' } }] }] })
      }
      return Response.json({ ret: 0 })
    })
    try {
      await adapter.initialize()
      const send = adapter.sendText(adapter.getOwnerChannel()!, '原消息', { weixinSource: { kind: 'answer', sessionId: 'original' } })
      const stop = adapter.destroy()
      response.resolve(Response.json({ message_id: '987' }))
      await Promise.all([send, stop])
      await restarted.initialize()
      restarted.onMessage(received)
      await waitUntil(() => received.mock.calls.length === 1)
      expect(received.mock.calls[0]![0]).toMatchObject({ text: '继续', weixinQuote: { sessionId: 'original', kind: 'answer' } })
    } finally {
      await restarted.destroy()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps persisted reply context scoped to its original peer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-weixin-peer-'))
    let owner = 'first'
    const adapter = new WeixinAdapter({ botId: 'b', token: 't', baseUrl: WEIXIN_BASE }, dir, () => {}, () => owner)
    let delivered = false
    let pending = true
    const sent: Array<{ to_user_id: string; context_token?: string }> = []
    spyOn(network, 'fetch').mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname
      if (path.endsWith('getupdates') && pending) {
        pending = false
        return Response.json({ msgs: [{ from_user_id: 'first', message_type: 1, message_id: '1',
          context_token: 'first-only', item_list: [{ type: 1, text_item: { text: 'hello' } }] }] })
      }
      if (path.endsWith('sendmessage')) sent.push(JSON.parse(String(init?.body)).msg)
      return Response.json({ ret: 0 })
    })
    try {
      await adapter.initialize()
      adapter.onMessage(async () => { delivered = true })
      await waitUntil(() => delivered)
      await adapter.sendText(JSON.stringify(['b', owner]), 'first reply')
      owner = 'second'
      await adapter.sendText(JSON.stringify(['b', owner]), 'second reply')
      expect(sent[0]).toMatchObject({ to_user_id: 'first', context_token: 'first-only' })
      expect(sent[1]?.to_user_id).toBe('second')
      expect(sent[1]).not.toHaveProperty('context_token')
    } finally {
      await adapter.destroy()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores a cancelled confirmation and never returns the bot token to the caller', async () => {
    const login = new WeixinLogin()
    const confirmation = Promise.withResolvers<Response>()
    spyOn(network, 'fetch').mockResolvedValueOnce(Response.json({ qrcode: 'qr', qrcode_img_content: 'display' }))
      .mockImplementationOnce(() => confirmation.promise)
    const connect = mock(async () => {})
    const attempt = 'cancel-test'
    expect(await login.handle({ attempt, action: 'start' }, connect)).toEqual({ status: 'qr', content: 'display' })
    const pending = login.handle({ attempt, action: 'poll' }, connect)
    await login.handle({ attempt, action: 'cancel' }, connect)
    confirmation.resolve(Response.json({ status: 'confirmed', bot_token: 'secret', ilink_bot_id: 'b', ilink_user_id: 'u' }))
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(connect).not.toHaveBeenCalled()
  })

  it('keeps the displayed page stable and rechecks eligibility before binding', () => {
    const picker = new WeixinSessionPicker('ws', () => [{ id: 'p', name: '测试项目' }])
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: 's' + i, name: '会话' + i, workspaceId: 'ws', lastMessageAt: 12 - i,
    } as Session))
    rows.push({ ...rows[0]!, id: 'other', workspaceId: 'other' }, { ...rows[0]!, id: 'internal', hidden: true })
    expect(picker.select('a', '', rows)).toEqual({ text: expect.stringContaining('项目 · 测试项目') })
    expect(picker.select('a', '1', rows)).toEqual({ text: expect.stringContaining('下一页') })
    expect(picker.select('b', '1', rows)).toEqual({ text: expect.stringContaining('先发送 /bind') })
    expect(picker.select('a', 'next', rows)).toEqual({ text: expect.stringContaining('11. 会话10') })
    rows[10]!.lastMessageAt = 100
    expect(picker.select('a', '11', rows)).toEqual({ session: rows[10]! })
    picker.select('a', '', rows)
    picker.select('a', '1', rows)
    rows[10]!.projectId = 'p'
    expect(picker.select('a', '1', rows)).toEqual({ text: expect.stringContaining('移出') })
    for (const id of ['other', 'internal']) expect(picker.select('a', id, rows)).toHaveProperty('text')
  })

  const questions = buildClarificationState({
    question: '输出格式？', selection: 'single', options: [], ambiguity: 'scope',
    questions: [
      { id: 'format', question: '输出格式？', selection: 'single', options: [{ id: 'md', label: 'Markdown' }] },
      { id: 'parts', question: '包含哪些部分？', selection: 'multi', options: [{ id: 'a', label: '摘要' }, { id: 'b', label: '明细' }] },
    ],
  }, { requestId: 'clarify-demo', round: 1, originSessionId: 's2' })

  it('validates each WeChat answer before submitting the batch', () => {
    expect(parseWeixinAnswers(questions, '1')).toBeTypeOf('string')
    expect(parseWeixinAnswers(questions, '2\n1,2')).toBeTypeOf('string')
    expect(parseWeixinAnswers(questions, '1,2\n1')).toBeTypeOf('string')
    expect(parseWeixinAnswers(questions, '文字：2026\n跳过')).toEqual({ answers: [
      { questionId: 'format', skipped: false, optionIds: [], text: '2026' }, { questionId: 'parts', skipped: true },
    ] })
    expect(parseWeixinAnswers(questions, '全部跳过')).toEqual({ skipped: true })
  })

  it.each(['owner', undefined])('pairs, routes, replies and restores with a returned user ID of %s', async userId => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-weixin-'))
    const credentials = new Map<string, { value: string }>()
    const submit = mock(async (_sessionId: string, _text: string) => {})
    const ask = structuredClone(questions)
    const result = '已修复高亮显示。✅😀'.repeat(210) + '气泡位置已核对。'
    const projectHistory = [
      { role: 'assistant', id: 'old', content: '上一轮的正文' },
      { role: 'user', id: 'request', content: '核对高亮和气泡' },
      { role: 'assistant', id: 'final', content: result, phase: 'final' },
      { role: 'assistant', id: 'internal', content: '内部推理', streamKind: 'thinking' },
    ]
    const respond = mock(async (_sessionId: string, _requestId: string, _response: ClarificationResponseInput) => {
      ask.status = 'answered'
      return true
    })
    const sessions: Pick<Session, 'id' | 'workspaceId' | 'name' | 'projectId'>[] = [{ id: 's1', name: 'Test', workspaceId: 'ws' }, { id: 's2', name: 'Project chat', workspaceId: 'ws', projectId: 'p' }]
    let settled!: (event: SessionCompletionEvent) => void
    const app = createMessagingBootstrap({
      getMessagingDir: id => join(dir, id),
      sessionManager: {
        onSessionComplete: (fn: typeof settled) => { settled = fn; return () => {} },
        getSessions: () => sessions, getSession: async (id: string) => ({ ...sessions.find(s => s.id === id),
          messages: id === 's2' ? [...projectHistory, { role: 'clarification', clarification: ask }] : [] }), respondToClarification: respond, sendMessage: submit, admitMessage: submit } as unknown as ISessionManager,
      credentialManager: {
        set: async (key: { name: string }, value: { value: string }) => { credentials.set(key.name, value) },
        get: async (key: { name: string }) => credentials.get(key.name),
        delete: async (key: { name: string }) => credentials.delete(key.name),
      } as unknown as CredentialManager,
    })
    const registry = app.registry
    let batch: object[] = []
    const lifecycle: string[] = []
    const outbound: Array<{ to_user_id: string; context_token: string; item_list: Array<{ text_item: { text: string } }> }> = []
    spyOn(network, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/msg/notify')) {
        lifecycle.push(url.pathname.split('/').pop()!)
        return Response.json({ ret: 0 })
      }
      if (url.pathname.endsWith('/get_bot_qrcode')) return Response.json({ qrcode: 'qr', qrcode_img_content: 'display' })
      if (url.pathname.endsWith('/get_qrcode_status')) return Response.json(url.searchParams.get('verify_code') === '1234'
        ? { status: 'confirmed', bot_token: 'secret', ilink_bot_id: 'bot', ilink_user_id: userId }
        : { status: 'need_verifycode' })
      if (url.pathname.endsWith('/getupdates')) {
        const msgs = batch
        batch = []
        return Response.json({ ret: 0, msgs, get_updates_buf: 'cursor' })
      }
      if (url.pathname.endsWith('/sendmessage')) {
        outbound.push(JSON.parse(String(init?.body)).msg)
        return Response.json(userId ? { ret: 0, message_id: String(outbound.length) } : { ret: 0 })
      }
      throw new Error('Unexpected endpoint')
    })
    const attempt = 'pair-test'
    const message = (message_id: string, text: string) => ({
      message_id, message_type: 1, from_user_id: 'owner', context_token: 'reply-context', item_list: [{ type: 1, text_item: { text } }],
    })
    try {
      await registry.updateConfig('ws', { platforms: { lark: { enabled: true, domain: 'feishu' } } })
      await registry.weixinLogin('ws', { action: 'start', attempt })
      expect(await registry.weixinLogin('ws', { action: 'poll', attempt })).toEqual({ status: 'pin' })
      expect(await registry.weixinLogin('ws', { action: 'poll', attempt, pin: '1234' })).toEqual({ status: 'connected' })
      const { code } = registry.generatePairingCode('ws', 's1', 'weixin')
      const text = message('text', 'hello')
      batch = [{ ...message('other', 'ignore'), from_user_id: 'stranger' },
        { ...message('group', 'ignore'), group_id: 'group' }, message('pair', '/pair ' + code), text, text]
      await waitUntil(() => submit.mock.calls.length === 1)
      expect(submit.mock.calls[0]?.slice(0, 2)).toEqual(['s1', 'hello'])
      const target = { to: 'workspace', workspaceId: 'ws' } as const
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { type: 'text_complete', sessionId: 's1', text: 'answer' })
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { type: 'complete', sessionId: 's1' })
      await waitUntil(() => outbound.some(item => item.item_list[0]?.text_item.text === '「普通会话 / Test」\nanswer'))
      expect(outbound.at(-1)).toMatchObject({ context_token: 'reply-context', to_user_id: 'owner' })
      batch = [message('menu', '/bind'), message('project', '2'), message('choose', '1'), message('after-switch', 'next')]
      await waitUntil(() => submit.mock.calls.length === 2)
      expect(submit.mock.calls[1]?.slice(0, 2)).toEqual(['s2', 'next'])
      expect(outbound.some(item => item.item_list[0]?.text_item.text.includes('项目 · p'))).toBe(true)
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { type: 'text_complete', sessionId: 's2', text: 'project answer' })
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { type: 'complete', sessionId: 's2' })
      await waitUntil(() => outbound.some(item => item.item_list[0]?.text_item.text === '「p / Project chat」\nproject answer'))
      batch = [message('menu2', '/bind'), message('ordinary', '/bind 1'), message('choose2', '1'), message('back', '1')]
      await waitUntil(() => submit.mock.calls.length === 3)
      expect(submit.mock.calls[2]?.slice(0, 2)).toEqual(['s1', '1'])
      const promptEvent = { type: 'clarification_request', sessionId: 's2', message: { role: 'clarification', clarification: ask } }
      const prompts = () => outbound.map(m => m.item_list[0]?.text_item.text).filter(t => t?.includes('\n【澄清 '))
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, promptEvent)
      expect(prompts()).toHaveLength(0)
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { ...promptEvent, sessionId: 's1', message: { role: 'clarification', clarification: { ...ask, originSessionId: 's1' } } })
      await waitUntil(() => prompts().length === 1)
      expect(prompts()[0]).toStartWith('「普通会话 / Test」\n【澄清 ')
      await registry.updateConfig('ws', { platforms: { weixin: { enabled: true, notifyOnCompletion: true } } })
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, promptEvent)
      await waitUntil(() => prompts().length === 2)
      const prompt = prompts()[1]!
      expect(prompt).toContain('包含哪些部分？')
      expect(prompt).toStartWith('「p / Project chat」\n【澄清 ')
      const answerCode = prompt.match(/\n【澄清 ([0-9a-f]+)】/)![1]
      const questionRef = userId ? { svr_id: String(outbound.findIndex(m => m.item_list[0]?.text_item.text === prompt) + 1) }
        : { message_item: { text_item: { text: prompt } } }
      const quoted = { ...message('quoted', ''), item_list: [{ type: 1, text_item: { text: '答 1\n1，2 + 详细说明' }, ref_msg: questionRef }] }
      batch = [message('invalid-choice', '/答 ' + answerCode + ' 3\n1'), quoted, message('duplicate-choice', '/答 ' + answerCode + ' 全部跳过')]
      await waitUntil(() => outbound.some(m => m.item_list[0]?.text_item.text.includes('这组问题已处理')))
      expect(respond.mock.calls).toEqual([['s2', ask.requestId, { answers: [
        { questionId: 'format', skipped: false, optionIds: ['md'], text: '' },
        { questionId: 'parts', skipped: false, optionIds: ['a', 'b'], text: '详细说明' },
      ] }]])
      expect(submit.mock.calls).toHaveLength(3)
      expect(registry.getBindings('ws')[0]?.sessionId).toBe('s1')
      const beforeCompletion = outbound.length
      const finish = (sessionId: string, text: string) => {
        registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { type: 'text_complete', sessionId, text })
        registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { type: 'complete', sessionId })
      }
      const bindingId = registry.getBindings('ws')[0]!.id
      registry.setBindingAccess('ws', bindingId, { mode: 'allow-list', allowedSenderIds: [] })
      finish('s1', 'restricted reply')
      registry.setBindingAccess('ws', bindingId, { mode: 'inherit' })
      finish('s2', 'unbound project reply')
      finish('s1', 'bound reply')
      await waitUntil(() => outbound.some(m => m.item_list[0]?.text_item.text === '「普通会话 / Test」\nbound reply'))
      expect(outbound.slice(beforeCompletion).map(m => m.item_list[0]?.text_item.text)).toEqual(['「普通会话 / Test」\nbound reply'])
      await registry.removeWorkspace('ws')
      await registry.initializeWorkspace('ws')
      expect(registry.getBindings('ws')).toMatchObject([{ sessionId: 's1', platform: 'weixin' }])
      expect(registry.getConfig('ws').runtime.weixin?.connected).toBe(true)
      expect(registry.getConfig('ws').runtime.weixin?.notifyOnCompletion).toBe(true)
      const done = { reason: 'complete', sessionId: 's2', workspaceId: 'ws', generation: 1, finalMessageId: 'final' } as const
      const notices = () => outbound.filter(m => m.item_list[0]?.text_item.text.includes('本轮任务已完成。'))
      settled({ ...done, sessionId: 's1' })
      settled({ ...done, reason: 'interrupted' })
      expect(notices()).toHaveLength(0)
      const ordinary = sessions.shift()!
      settled(done)
      expect(notices()).toHaveLength(0)
      sessions.unshift(ordinary)
      const beforeNotice = outbound.length
      settled(done)
      settled(done)
      await waitUntil(() => outbound.some(m => m.item_list[0]?.text_item.text.includes('气泡位置已核对。')))
      const delivered = outbound.slice(beforeNotice).map(m => m.item_list[0]!.text_item.text)
      expect(delivered).toHaveLength(2)
      expect(delivered.every(text => text.length <= 2000)).toBe(true)
      expect(delivered.map(t => t.replace(/^「p \/ Project chat」(?:本轮任务已完成。)?\n+/, '').split('\n\n引用这条消息')[0]).join('')).toBe(result)
      expect(notices()).toHaveLength(1)
      const notice = notices()[0]!.item_list[0]!.text_item.text
      expect(notice).toStartWith('「p / Project chat」本轮任务已完成。')
      const reference = (id: string, body: string, reply: string) => {
        const ref = userId ? { svr_id: String(outbound.findIndex(m => m.item_list[0]?.text_item.text === body) + 1) }
          : { message_item: { text_item: { text: body } } }
        return { ...message(id, reply), item_list: [{ type: 1, text_item: { text: reply }, ref_msg: { ...ref, partial_text: { start: '高', end: '。', startindex: 0, endindex: 0 } } }] }
      }
      batch = [reference('quoted-answer', delivered[1]!, '请展开'), message('still-bound', '继续普通会话')]
      await waitUntil(() => submit.mock.calls.length === 5)
      expect(submit.mock.calls[3]?.slice(0, 2)).toEqual(['s2', '请展开'])
      expect(submit.mock.calls[4]?.slice(0, 2)).toEqual(['s1', '继续普通会话'])
      const options = (submit.mock.calls[3] as unknown[])[4] as { optimisticMessageId: string }
      const promoted = { type: 'user_message', sessionId: 's2', message: { clientMessageId: options.optimisticMessageId } }
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { ...promoted, status: 'queued' })
      finish('s2', 'previous turn')
      registry.onSessionEvent(RPC_CHANNELS.sessions.EVENT, target, { ...promoted, status: 'processing' })
      finish('s2', '展开后的回复')
      settled({ ...done, generation: 2 })
      await waitUntil(() => outbound.some(m => m.item_list[0]?.text_item.text === '「p / Project chat」\n展开后的回复'))
      expect(outbound.some(m => m.item_list[0]?.text_item.text.includes('previous turn'))).toBe(false)
      expect(notices()).toHaveLength(1)
      // A later turn without a fresh final message produces the legacy notice,
      // which can retrieve the latest visible answer without running the model.
      settled({ ...done, generation: 3, finalMessageId: 'old' })
      await waitUntil(() => notices().length === 2)
      const legacy = notices()[1]!.item_list[0]!.text_item.text
      expect(legacy).not.toContain('上一轮的正文')
      const beforeRead = outbound.length
      batch = [reference('read', legacy, '查看最新回复')]
      await waitUntil(() => outbound.slice(beforeRead).some(m => m.item_list[0]?.text_item.text.includes('气泡位置已核对。')))
      expect(submit.mock.calls).toHaveLength(5)
      expect(registry.getBindings('ws')[0]?.sessionId).toBe('s1')
      batch = [reference('switch', notice, '切换'), message('switched', '现在的会话')]
      await waitUntil(() => submit.mock.calls.length === 6)
      expect(submit.mock.calls[5]?.slice(0, 2)).toEqual(['s2', '现在的会话'])
      expect(registry.getBindings('ws')[0]?.sessionId).toBe('s2')
      batch = [reference('back-to-ordinary', '「普通会话 / Test」\nanswer', '继续普通的内容')]
      await waitUntil(() => submit.mock.calls.length === 7)
      expect(submit.mock.calls[6]?.slice(0, 2)).toEqual(['s1', '继续普通的内容'])
      expect(registry.getBindings('ws')[0]?.sessionId).toBe('s2')
      batch = [{ ...message('stale', '错误会话'), item_list: [{ type: 1, text_item: { text: '错误会话' }, ref_msg: { svr_id: '99999999' } }] }]
      await waitUntil(() => outbound.some(m => m.item_list[0]?.text_item.text.startsWith('无法定位这条引用')))
      expect(submit.mock.calls).toHaveLength(7)
      await registry.updateConfig('ws', { platforms: { weixin: { enabled: true, notifyOnCompletion: false } } })
      expect(registry.getConfig('ws').runtime.weixin?.notifyOnCompletion).toBe(false)
      settled({ ...done, sessionId: 's1', generation: 3 })
      expect(notices()).toHaveLength(2)
      await registry.disconnectPlatform('ws', 'weixin')
      expect(registry.getConfig('ws').platforms.lark?.enabled).toBe(true)
      expect(registry.getConfig('ws').platforms.weixin?.enabled).toBe(false)
      expect(credentials.has('weixin')).toBe(false)
      expect(lifecycle).toEqual(['notifystart', 'notifystop', 'notifystart', 'notifystop'])
    } finally {
      await app.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
