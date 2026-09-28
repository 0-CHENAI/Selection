import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '@craft-agent/core'
import { storedToMessage } from '@craft-agent/core'
import type { AnswerDeliveryControl } from '@craft-agent/shared/agent/backend/types'
import { createTypedError } from '@craft-agent/shared/agent/errors'
import { getSessionPath, loadSession as loadStoredSession } from '@craft-agent/shared/sessions'
import { createManagedSession, loadPiTurnAnchors, SessionManager } from './SessionManager'
import { ArtifactVersions } from '../reliability/artifact-versions'
import { ConversationArtifactVersions } from '../reliability/conversation-artifact-versions'

const explanation = '蒙提霍尔问题\n\n1. 三扇门，主持人知道奖品位置。\n2. 主持人打开一扇有羊的门。\n\n| 策略 | 胜率 |\n| --- | --- |\n| 换门 | 2/3 |\n| 不换 | 1/3 |'
const markdown = `${explanation}\n\n模拟结果：换门胜率约为 2/3。`
const submission = { markdown, toolCallId: 'submit-330', sdkMessageId: 'sdk-message', sdkTurnAnchor: 'sdk-assistant-entry' }

describe('explicit answer delivery lifecycle (#330)', () => {
  let root: string
  let manager: SessionManager
  let managed: ReturnType<typeof createManagedSession>
  let events: any[]
  let control: AnswerDeliveryControl | undefined
  let prompts: string[]
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'selection-answer-'))
    manager = new SessionManager()
    managed = createManagedSession({ id: 'answer-test', name: 'Existing session' },
      { id: 'workspace', name: 'Workspace', rootPath: root, createdAt: Date.now() } as never,
      { messagesLoaded: true })
    ;(manager as any).sessions.set(managed.id, managed)
    events = []; prompts = []; control = undefined
    manager.setEventSink((_channel, _target, event) => events.push(event))
  })
  afterEach(async () => { await manager.flushSession(managed.id); rmSync(root, { recursive: true, force: true }) })
  function install(chat: (index: number) => AsyncGenerator<AgentEvent>) {
    const agent = {
      configureAnswerDelivery(value: AnswerDeliveryControl | undefined) { control = value },
      setAllSources() {}, getModel() { return 'test-model' }, getSessionId() { return 'sdk-session' },
      chat(prompt: string) { prompts.push(prompt); return chat(prompts.length) },
    }
    ;(manager as any).getOrCreateAgent = async () => agent
    return agent
  }
  function feedbackOptions() {
    managed.messages = [{ id: 'original', role: 'assistant', content: 'Original answer', timestamp: 1,
      annotations: [{ id: 'note', schemaVersion: 1, createdAt: 1,
        body: [{ type: 'note', text: 'Revise this' }],
        target: { source: { sessionId: managed.id, messageId: 'original' }, selectors: [{ type: 'text-quote', exact: 'Original' }] },
      }],
    }]
    return { annotationFollowUps: [{ messageId: 'original', annotationId: 'note', text: 'Revise this', updatedAt: 1 }] }
  }

  it('publishes text before an independent file review adds only the report card', async () => {
    const report = join(getSessionPath(root, managed.id), '中文 报告.html')
    const helper = join(getSessionPath(root, managed.id), 'build.js')
    let releaseReview!: () => void
    const reviewGate = new Promise<void>(resolve => { releaseReview = resolve })
    const agent = install(async function* () {
      writeFileSync(report, '<html><body>hello</body></html>')
      writeFileSync(helper, 'console.log("build")')
      await control!.submit({ ...submission, markdown: '报告完成。', featuredArtifacts: [report, helper] })
      yield { type: 'complete' }
    })
    ;(agent as any).queryLlm = async (request: { prompt: string }) => {
      await reviewGate
      const files = (JSON.parse(request.prompt) as { files: Array<{ id: number; path: string }> }).files
      expect(files.some(file => file.path.endsWith('中文 报告.html'))).toBe(true)
      return { text: JSON.stringify({ decisions: files.map(file => ({ id: file.id,
        role: file.path.endsWith('中文 报告.html') ? 'primary' : 'supporting', reason: file.path.endsWith('中文 报告.html') ? 'Finished report' : 'Build helper',
      })) }) }
    }
    managed.agent = agent as never
    await manager.sendMessage(managed.id, '生成一份 HTML 报告')
    expect(events.some(event => event.type === 'text_complete' && event.answerCommitted)).toBe(true)
    expect(events.find(event => event.type === 'text_complete' && event.answerCommitted)?.featuredArtifacts).toEqual([])
    for (let i = 0; i < 100 && !events.some(event => event.type === 'artifact_selection_updated' && event.artifactReviewStatus === 'pending'); i++) await Bun.sleep(10)
    expect(events.some(event => event.type === 'artifact_selection_updated' && event.artifactReviewStatus === 'pending')).toBe(true)
    expect(events.some(event => event.type === 'artifact_selection_updated' && event.artifactReviewStatus === 'complete')).toBe(false)
    releaseReview()
    for (let i = 0; i < 100 && !events.some(event => event.type === 'artifact_selection_updated' && event.artifactReviewStatus === 'complete'); i++) await Bun.sleep(10)
    const update = events.find(event => event.type === 'artifact_selection_updated' && event.artifactReviewStatus === 'complete')
    expect(update?.featuredArtifacts?.[0]?.endsWith('中文 报告.html')).toBe(true)
    expect(loadStoredSession(root, managed.id)?.messages.map(storedToMessage).at(-1)?.featuredArtifacts?.[0]?.endsWith('中文 报告.html')).toBe(true)
  })

  it('confirms one matching new file without a second model call', async () => {
    const report = join(getSessionPath(root, managed.id), '中文 报告.html')
    const agent = install(async function* () {
      writeFileSync(report, '<html>hello</html>')
      await control!.submit({ ...submission, markdown: '报告完成。', featuredArtifacts: [report] })
      yield { type: 'complete' }
    })
    ;(agent as any).queryLlm = () => { throw new Error('The fast path should not query a model') }
    managed.agent = agent as never
    await manager.sendMessage(managed.id, '生成一份 HTML 报告')
    for (let i = 0; i < 100 && !events.some(event => event.type === 'artifact_selection_updated' && event.artifactReviewStatus === 'complete'); i++) await Bun.sleep(10)
    expect(events.find(event => event.type === 'artifact_selection_updated' && event.artifactReviewStatus === 'complete')?.featuredArtifacts?.map((path: string) => path.endsWith('中文 报告.html'))).toEqual([true])
  })

  it('does not show artifact progress for a reply that produced no files', async () => {
    install(async function* () {
      await control!.submit({ ...submission, markdown: '你好。', featuredArtifacts: [] })
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '打个招呼')
    expect(events.some(event => event.type === 'text_complete' && event.answerCommitted)).toBe(true)
    expect(events.some(event => event.type === 'artifact_selection_updated')).toBe(false)
  })

  it('keeps marker-mode model prose private until the durable answer is committed', async () => {
    const body = '润色与重构已完成。\n\n交付结果：[新报告](report.docx)'
    install(async function* () {
      yield { type: 'tool_start', toolUseId: 'read', toolName: 'Read', input: {} }
      yield { type: 'tool_result', toolUseId: 'read', toolName: 'Read', result: 'checked', isError: false }
      yield { type: 'text_delta', text: body, phase: 'intermediate', presentationProtocol: 'marker-v1', turnId: 'draft' }
      yield { type: 'text_complete', text: body, phase: 'intermediate', presentationProtocol: 'marker-v1', turnId: 'draft', sdkMessageId: 'draft-sdk' }
      expect(events.some(event => event.type === 'text_delta' || event.type === 'text_complete')).toBe(false)
      await control!.submit({ ...submission, markdown: body })
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '更新报告')
    expect(events.some(event => event.type === 'tool_start' && event.toolUseId === 'read')).toBe(true)
    expect(events.filter(event => event.type === 'text_complete')).toEqual([
      expect.objectContaining({ text: body, answerCommitted: true }),
    ])
    expect(events.some(event => event.type === 'text_delta')).toBe(false)
    expect(managed.messages.find(message => message.content === body && message.isIntermediate)?.hidden).toBe(true)
    expect(loadStoredSession(root, managed.id)?.messages.map(storedToMessage).find(message => message.content === body && message.isIntermediate)?.hidden).toBe(true)
  })

  it('keeps an unmarked final draft out of the work chain before submit_answer', async () => {
    const body = '交付完成：[新报告](report.docx)'
    install(async function* () {
      yield { type: 'text_delta', text: body.slice(0, 4), turnId: 'draft' }
      ;(manager as any).flushDelta(managed.id, managed.workspace.id)
      yield { type: 'text_delta', text: body.slice(4), turnId: 'draft' }
      yield { type: 'text_complete', text: body, turnId: 'draft', sdkMessageId: 'draft-sdk' }
      expect(events.some(event => event.type === 'text_delta' || event.type === 'text_complete')).toBe(false)
      await control!.submit({ ...submission, markdown: body })
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '更新报告')
    expect(events.filter(event => event.type === 'text_complete')).toEqual([
      expect.objectContaining({ text: body, answerCommitted: true }),
    ])
    expect(managed.messages.find(message => message.isIntermediate && message.content === body)?.hidden).toBe(true)
  })

  it('streams provider-classified commentary while keeping the submitted answer separate', async () => {
    install(async function* () {
      yield { type: 'text_delta', text: '正在', phase: 'intermediate', presentationProtocol: 'legacy', turnId: 'progress' }
      ;(manager as any).flushDelta(managed.id, managed.workspace.id)
      expect(events.filter(event => event.type === 'text_delta')).toEqual([
        expect.objectContaining({ delta: '正在', phase: 'intermediate', turnId: 'progress' }),
      ])
      yield { type: 'text_delta', text: '检查。', phase: 'intermediate', presentationProtocol: 'legacy', turnId: 'progress' }
      yield { type: 'text_complete', text: '正在检查。', phase: 'intermediate', presentationProtocol: 'legacy', turnId: 'progress' }
      await control!.submit({ ...submission, markdown: '检查完成。' })
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '检查报告')
    expect(events.filter(event => event.type === 'text_delta').map(event => event.delta)).toEqual(['正在', '检查。'])
    expect(events.filter(event => event.type === 'text_complete').map(event => [event.text, event.isIntermediate])).toEqual([
      ['正在检查。', true], ['检查完成。', false],
    ])
    expect(managed.messages.find(message => message.content === '正在检查。')?.hidden).toBeFalsy()
  })

  it('materializes a streamed commentary fragment if the provider omits text_complete', async () => {
    install(async function* () {
      yield { type: 'text_delta', text: '检查中', phase: 'intermediate', presentationProtocol: 'legacy', turnId: 'progress' }
      ;(manager as any).flushDelta(managed.id, managed.workspace.id)
      ;(manager as any).finalizeDanglingTextStream(managed)
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '检查报告')
    expect(events).toContainEqual(expect.objectContaining({ type: 'text_delta', delta: '检查中', turnId: 'progress' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'text_complete', text: '检查中', isIntermediate: true, turnId: 'progress' }))
  })

  it('can salvage a private draft if both formal delivery attempts fail', async () => {
    install(async function* () {
      yield { type: 'text_complete', text: '可交付正文', phase: 'intermediate', presentationProtocol: 'marker-v1', turnId: 'draft' }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释结果')
    expect(prompts).toHaveLength(2)
    expect(events.filter(event => event.type === 'text_complete')).toEqual([
      expect.objectContaining({ text: '可交付正文', answerCommitted: true, answerSalvaged: true }),
    ])
    expect(managed.messages.find(message => message.isIntermediate)?.hidden).toBe(true)
  })

  it('records ordinary chat file edits and publishes the same snapshot identity as the saved answer', async () => {
    const file = join(root, 'report.html')
    writeFileSync(file, 'before')
    managed.workingDirectory = root
    managed.messages = [{ id: 'previous', role: 'assistant', content: '[报告](report.html)', timestamp: 1 }]
    install(async function* () {
      writeFileSync(file, 'after')
      await control!.submit({ ...submission, markdown: '已调整报告颜色。\n\n[已修改报告](report.html)', artifactVersionTitle: '统一报告配色与重点标注' })
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '调整报告颜色')
    const answer = loadStoredSession(root, managed.id)!.messages.find(message => message.answerCommitted)!
    const event = events.find(event => event.type === 'text_complete' && event.answerCommitted)!
    expect(event.artifactVersions).toEqual(answer.artifactVersions)
    expect(answer.artifactVersions).toHaveLength(1)
    expect(answer.artifactVersions![0]).toMatchObject({ path: 'report.html', ordinal: 2, change: 'modified' })
    const versions = new ArtifactVersions(join(root, 'artifacts', 'versions'), hostname(), managed.workspace.id)
    const record = versions.findByPath(file)!
    expect(record.versions).toHaveLength(2)
    expect(record.versions[1]).toMatchObject({ summary: '统一报告配色与重点标注', summaryOrigin: 'assistant' })
    expect(versions.versionBytes(record.id, record.versions[0]!.id).toString()).toBe('before')
    expect(prompts).toHaveLength(1)
  })

  it('persists the pending tool before awaiting artifact baseline recording', async () => {
    const trackPath = ConversationArtifactVersions.prototype.trackPath
    let checked = false
    ConversationArtifactVersions.prototype.trackPath = async function (path) {
      const checkpoint = JSON.parse(readFileSync(join(getSessionPath(root, managed.id), 'data', 'execution-checkpoint.json'), 'utf8'))
      expect(checkpoint.pendingTools['write-1']).toMatchObject({ name: 'Write', recovery: 'unknown' })
      checked = true
      await trackPath.call(this, path)
    }
    managed.workingDirectory = root
    install(async function* () {
      yield { type: 'tool_start', toolName: 'Write', toolUseId: 'write-1', input: { file_path: join(root, 'report.txt') } }
      yield { type: 'tool_result', toolUseId: 'write-1', toolName: 'Write', result: 'done', isError: false }
      await control!.submit(submission)
      yield { type: 'complete' }
    })
    try {
      await manager.sendMessage(managed.id, 'Create report')
      expect(checked).toBe(true)
    } finally { ConversationArtifactVersions.prototype.trackPath = trackPath }
  })

  it('context admission failure preserves input and preview without starting answer recovery or promoting a draft', async () => {
    install(async function* () {
      yield { type: 'text_complete', text: 'Incomplete work preview' }
      yield { type: 'typed_error', error: createTypedError('context_limit') }
      yield { type: 'complete' }
    })
    const input = '原始输入\r\n' + '文'.repeat(100_000)
    await manager.sendMessage(managed.id, input)
    await manager.flushSession(managed.id)
    expect(prompts).toEqual([input])
    const stored = loadStoredSession(root, managed.id)!
    const user = stored.messages.find(message => message.type === 'user')!
    expect(user.content).toBe(input)
    expect(user.answerRecoveryAttempted).not.toBe(true)
    expect(stored.messages.filter(message => message.errorCode === 'context_limit')).toHaveLength(1)
    expect(stored.messages.find(message => message.errorCode === 'context_limit')!.errorCanRetry).toBe(false)
    expect(stored.messages.some(message => message.answerCommitted)).toBe(false)
    expect(stored.messages.some(message => message.content === 'Incomplete work preview')).toBe(true)
    expect(events.some(event => event.type === 'text_complete' && event.answerCommitted)).toBe(false)
    expect(managed.isProcessing).toBe(false)
  })

  for (const failure of ['error', 'cancel', 'missing'] as const) {
    it(`persists a feedback terminal status without pretending it was delivered (${failure})`, async () => {
      const options = feedbackOptions()
      install(async function* () {
        if (failure === 'error') yield { type: 'error', message: 'provider unavailable' }
        if (failure === 'cancel') managed.stopRequested = true
        yield { type: 'complete' }
      })
      await manager.sendMessage(managed.id, 'Revise', undefined, undefined, options)
      const source = loadStoredSession(root, managed.id)!.messages.find(message => message.id === 'original')!
      const followUp = source.annotations![0]!.meta!.followUp as Record<string, unknown>
      expect(followUp.status).toBe(failure === 'cancel' ? 'interrupted' : 'failed')
      expect(followUp.resultMessageId).toBeUndefined()
      expect(source.annotations![0]!.status).not.toBe('resolved')
      const statusEvents = events.filter(event => event.type === 'message_annotations_updated')
        .map(event => event.annotations[0].meta.followUp.status)
      expect(statusEvents).toContain('running')
      expect(statusEvents.at(-1)).toBe(followUp.status)
    })
  }

  it('cancellation during feedback terminal persistence retains cancellation ownership', async () => {
    const options = feedbackOptions()
    const flush = manager.flushSession.bind(manager)
    let cancelledDuringFlush = false
    manager.flushSession = async id => {
      if ((managed.messages[0]?.annotations?.[0]?.meta?.followUp as any)?.status === 'failed') {
        managed.stopRequested = true
        cancelledDuringFlush = true
      }
      await flush(id)
    }
    install(async function* () { yield { type: 'error', message: 'provider unavailable' }; yield { type: 'complete' } })
    const completed: any[] = []
    manager.onSessionComplete(event => completed.push(event))
    await manager.sendMessage(managed.id, 'Revise', undefined, undefined, options)
    expect(cancelledDuringFlush).toBe(true)
    expect(completed.at(-1)?.reason).toBe('interrupted')
    const source = loadStoredSession(root, managed.id)!.messages.find(message => message.id === 'original')!
    expect(source.annotations![0]!.meta?.followUp).toMatchObject({ status: 'interrupted' })
    expect(managed.isProcessing).toBe(false)
  })

  for (const salvaged of [false, true]) {
    it(`persists annotation feedback result before publication and reloads its source (salvaged=${salvaged})`, async () => {
      const original = 'Original paragraph to revise'
      managed.messages = [{
        id: 'original', role: 'assistant', content: original, timestamp: 1,
        annotations: [{ id: 'note', schemaVersion: 1, createdAt: 1,
          body: [{ type: 'note', text: 'Explain more clearly' }],
          target: { source: { sessionId: managed.id, messageId: 'original' }, selectors: [] },
        }],
      }]
      let resultPersistedBeforeEvent = false
      manager.setEventSink((_channel, _target, event: any) => {
        events.push(event)
        if (event.type === 'message_annotations_updated' && event.annotations[0]?.meta?.followUp?.resultMessageId) {
          const stored = loadStoredSession(root, managed.id)!
          const source = stored.messages.find(message => message.id === 'original')!
          const resultId = event.annotations[0].meta.followUp.resultMessageId
          resultPersistedBeforeEvent = (source.annotations![0]!.meta?.followUp as any).resultMessageId === resultId
            && stored.messages.some(message => message.id === resultId && message.answerCommitted)
        }
      })
      install(async function* () {
        yield { type: 'text_complete', text: markdown }
        if (!salvaged) await control!.submit(submission)
        yield { type: 'complete' }
      })
      await manager.sendMessage(managed.id, 'Revise the paragraph', undefined, undefined, {
        annotationFollowUps: [{ messageId: 'original', annotationId: 'note', text: 'Explain more clearly', updatedAt: 1 }],
      })
      const reloaded = loadStoredSession(root, managed.id)!.messages.map(storedToMessage)
      const source = reloaded.find(message => message.id === 'original')!
      const followUp = source.annotations![0]!.meta!.followUp as Record<string, unknown>
      const result = reloaded.find(message => message.id === followUp.resultMessageId)!
      expect(source.content).toBe(original)
      expect(followUp.status).toBe('delivered')
      expect(followUp.resultSalvaged).toBe(salvaged)
      expect(followUp.resultAnswerRunId).toBe(result.answerRunId)
      expect(result.answerCommitted).toBe(true)
      expect(result.content).toBe(markdown)
      expect(resultPersistedBeforeEvent).toBe(true)
      expect(events.filter(event => event.type === 'text_complete' && event.answerCommitted)).toHaveLength(1)
    })
  }

  it('persists complete Markdown before publication and survives rehydration plus late events', async () => {
    let persistedBeforeEvent = false
    manager.setEventSink((_channel, _target, event: any) => {
      events.push(event)
      if (event.answerCommitted) {
        persistedBeforeEvent = !!loadStoredSession(root, managed.id)?.messages.find(m => m.id === event.messageId && m.content === markdown)
      }
    })
    install(async function* () {
      yield { type: 'text_complete', text: explanation, phase: 'final' }
      yield { type: 'tool_start', toolName: 'Bash', toolUseId: 'simulation', input: { command: 'simulate' } }
      yield { type: 'tool_result', toolUseId: 'simulation', result: '0.6667', isError: false }
      yield { type: 'text_complete', text: '模拟证实了结果。' }
      yield { type: 'tool_start', toolName: 'submit_answer', toolUseId: submission.toolCallId, input: { markdown } }
      await control!.submit(submission)
      yield { type: 'tool_result', toolName: 'submit_answer', toolUseId: submission.toolCallId, result: 'Answer delivered.', isError: false }
      yield { type: 'pi_turn_anchor', sdkMessageId: submission.sdkMessageId, sdkTurnAnchor: 'sdk-tool-result-entry' }
      yield { type: 'text_complete', text: '已完成。' }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释蒙提霍尔问题并验证')
    expect(persistedBeforeEvent).toBe(true)
    expect(prompts).toHaveLength(1)
    expect(managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
    expect(managed.messages.find(m => m.toolUseId === submission.toolCallId)?.toolInput).toEqual({})
    const stored = loadStoredSession(root, managed.id)!
    const delivered = stored.messages.map(storedToMessage).filter(m => m.answerCommitted)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.content).toBe(markdown)
    expect(delivered[0]?.answerRoutingVersion).toBe(1)
    expect(stored.messages.find(m => m.type === 'user')?.answerRoutingVersion).toBe(1)
    expect(stored.messages.find(m => m.toolUseId === submission.toolCallId)?.toolPurpose).toBe('answer-delivery')
    expect(events.find(e => e.type === 'tool_result' && e.toolUseId === 'simulation')?.toolPurpose).toBe('work')
    expect(events.find(e => e.answerCommitted)?.answerRoutingVersion).toBe(1)
    const answer = managed.messages.find(m => m.answerCommitted)!
    expect((await loadPiTurnAnchors(getSessionPath(root, managed.id))).anchors[answer.id]).toBe('sdk-tool-result-entry')
    expect(events.filter(e => e.answerCommitted)).toHaveLength(1)
    expect(managed.isProcessing).toBe(false)
  })
  it('classifies existing aliases exactly and keeps purpose from the start event', async () => {
    const names = ['submit_answer', 'session__submit_answer', 'mcp__session__submit_answer', 'SUBMIT_ANSWER', 'mcp__other__submit_answer', 'submit_answer_extra']
    install(async function* () {
      for (const [i, toolName] of names.entries()) {
        yield { type: 'tool_start', toolName, toolUseId: `alias-${i}`, input: { toolPurpose: 'answer-delivery' } }
        yield { type: 'tool_result', toolUseId: `alias-${i}`, result: 'done', isError: false }
      }
      await control!.submit(submission)
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '别名测试')
    for (const [i] of names.entries()) {
      const purpose = i < 3 ? 'answer-delivery' : 'work'
      expect(managed.messages.find(m => m.toolUseId === `alias-${i}`)?.toolPurpose).toBe(purpose)
      expect(events.find(e => e.type === 'tool_result' && e.toolUseId === `alias-${i}`)?.toolPurpose).toBe(purpose)
    }
    expect(events.find(e => e.type === 'complete')).toMatchObject({ answerRoutingVersion: 1 })
  })
  for (const version of [undefined, 1] as const) {
    it(`inherits routing version on auth continuation (${version ?? 'legacy'})`, async () => {
      managed.messages = [{ id: 'owner', role: 'user', content: '问题', timestamp: 1,
        answerProtocol: 'explicit-v1', answerRunId: 'retained', answerRoutingVersion: version }]
      install(async function* () { await control!.submit(submission); yield { type: 'complete' } })
      await manager.sendMessage(managed.id, '继续', undefined, undefined, undefined, 'owner', true)
      const answer = managed.messages.find(m => m.answerCommitted)
      expect(answer?.answerRunId).toBe('retained')
      expect(answer?.answerRoutingVersion).toBe(version)
      expect(events.find(e => e.answerCommitted)?.answerRoutingVersion).toBe(version)
    })
  }
  it('recovers once in the retained task and persists the recovery attempt', async () => {
    install(async function* (index) {
      if (index === 1) yield { type: 'text_complete', text: explanation }
      else { expect(control?.recovery).toBe(true); await control!.submit(submission) }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释并验证')
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('Only submit_answer')
    expect(managed.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(loadStoredSession(root, managed.id)?.messages.find(m => m.type === 'user')?.answerRecoveryAttempted).toBe(true)
    expect(managed.messages.find(m => m.answerCommitted)?.content).toBe(markdown)
  })
  it('promotes the latest draft when recovery also omits delivery (#403)', async () => {
    install(async function* () { yield { type: 'text_complete', text: '一句补充' }; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释并验证')
    expect(prompts).toHaveLength(2)
    const committed = managed.messages.filter(m => m.answerCommitted)
    expect(committed).toHaveLength(1)
    expect(committed[0]?.content).toBe('一句补充')
    expect(committed[0]?.answerSalvaged).toBe(true)
    expect(events.find(e => e.answerCommitted)).toMatchObject({ answerSalvaged: true, answerRoutingVersion: 1 })
    expect(managed.messages.some(m => m.role === 'error')).toBe(false)
    expect(managed.isProcessing).toBe(false)
    const stored = loadStoredSession(root, managed.id)!
    const storedCommitted = stored.messages.filter(m => m.answerCommitted)
    expect(storedCommitted).toHaveLength(1)
    expect(storedCommitted[0]?.answerSalvaged).toBe(true)
    expect(stored.messages.some(m => m.isIntermediate && m.content === '一句补充')).toBe(true)
    expect(events.filter(e => e.answerCommitted)).toHaveLength(1)
  })
  it('recovers the screenshot sequence after four invalid searches without losing the answer', async () => {
    install(async function* (index) {
      if (index === 1) {
        for (let n = 0; n < 4; n++) {
          yield { type: 'tool_start', toolName: 'WebSearch', toolUseId: `search-${n}`, input: {} }
          yield { type: 'tool_result', toolUseId: `search-${n}`, result: 'query is required', isError: true }
        }
        yield { type: 'text_complete', text: explanation, sdkMessageId: 'draft-sdk' }
        yield { type: 'pi_turn_anchor', sdkMessageId: 'draft-sdk', sdkTurnAnchor: 'draft-anchor' }
      } else {
        yield { type: 'text_complete', text: markdown, sdkMessageId: 'recovery-sdk' }
        yield { type: 'pi_turn_anchor', sdkMessageId: 'recovery-sdk', sdkTurnAnchor: 'recovery-anchor' }
      }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释并验证')
    const answer = managed.messages.find(m => m.answerCommitted)!
    expect(answer.content).toBe(markdown)
    expect(answer.answerSalvaged).toBe(true)
    expect(managed.messages.filter(m => m.role === 'tool' && m.isError)).toHaveLength(4)
    expect(managed.messages.some(m => m.role === 'error')).toBe(false)
    expect((await loadPiTurnAnchors(getSessionPath(root, managed.id))).anchors[answer.id]).toBe('recovery-anchor')
    expect(loadStoredSession(root, managed.id)?.messages.find(m => m.id === answer.id)?.content).toBe(markdown)
  })
  it('durably recovers a regenerated draft with its SDK anchor before publication', async () => {
    managed.messages = [
      { id: 'user', role: 'user', content: '解释', timestamp: 1 },
      { id: 'old', role: 'assistant', content: '旧答案', timestamp: 2 },
    ]
    managed.sdkSessionId = 'old-sdk'
    managed.regenerateTransaction = { runId: 'regenerate', keepThroughMessageId: 'user', rendererTruncated: false,
      originalMessages: structuredClone(managed.messages), originalSdkSessionId: 'old-sdk' }
    manager.setEventSink((_channel, _target, event: any) => {
      events.push(event)
      if (event.answerCommitted) {
        expect(managed.regenerateTransaction).toBeUndefined()
        expect(loadStoredSession(root, managed.id)?.messages.find(m => m.id === event.messageId)?.content).toBe(markdown)
      }
    })
    install(async function* (index) {
      managed.sdkSessionId = 'new-sdk'
      yield { type: 'text_complete', text: index === 1 ? explanation : markdown, sdkMessageId: `sdk-${index}` }
      yield { type: 'pi_turn_anchor', sdkMessageId: `sdk-${index}`, sdkTurnAnchor: `anchor-${index}` }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释', undefined, undefined, undefined, 'user')
    const answer = managed.messages.find(m => m.answerCommitted)!
    expect(answer.content).toBe(markdown)
    expect(answer.answerSalvaged).toBe(true)
    expect((await loadPiTurnAnchors(getSessionPath(root, managed.id))).anchors[answer.id]).toBe('anchor-2')
    expect(managed.messages.some(m => m.id === 'old')).toBe(false)
    expect(loadStoredSession(root, managed.id)?.sdkSessionId).toBe('new-sdk')
    expect(events.filter(e => e.answerCommitted)).toHaveLength(1)
  })
  for (const waitingFor of ['tool', 'worker', 'aggregation'] as const) {
    it(`does not salvage around an unfinished ${waitingFor} during recovery`, async () => {
      install(async function* (index) {
        yield { type: 'text_complete', text: markdown }
        if (index === 2) {
          if (waitingFor === 'tool') yield { type: 'tool_start', toolName: 'Bash', toolUseId: 'pending', input: {} }
          else if (waitingFor === 'worker') (manager as any).pendingSwarmChildren.set(managed.id, 1)
          else {
            managed.orchestrationStatus = 'running'
            managed.orchestrationId = 'swarm'
            managed.orchestrationAggregation = { phase: 'waiting-workers', orchestrationId: 'swarm' } as any
          }
        }
        yield { type: 'complete' }
      })
      await manager.sendMessage(managed.id, '解释')
      expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
      expect(events.some(e => e.answerCommitted)).toBe(false)
    })
  }
  for (const failure of ['cancel', 'storage'] as const) {
    it(`does not publish a recovered answer after ${failure} during its flush`, async () => {
      const flush = manager.flushSession.bind(manager)
      install(async function* () {
        yield { type: 'text_complete', text: markdown }
        yield { type: 'complete' }
      })
      manager.flushSession = async id => {
        if (managed.messages.some(m => m.answerSalvaged)) {
          if (failure === 'cancel') managed.stopRequested = true
          else throw new Error('disk unavailable')
        }
        await flush(id)
      }
      await manager.sendMessage(managed.id, '解释')
      expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
      expect(events.some(e => e.answerCommitted)).toBe(false)
      expect(loadStoredSession(root, managed.id)?.messages.some(m => m.answerCommitted)).toBe(false)
      const errors = managed.messages.filter(m => m.role === 'error')
      if (failure === 'storage') expect(errors.some(m => m.errorCode === 'answer_persistence_failed')).toBe(true)
      else expect(errors.some(m => m.errorCode === 'answer_delivery_missing')).toBe(false)
    })
  }
  it('ends with an explicit error when recovery omits delivery and no draft can be salvaged', async () => {
    install(async function* () { yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释并验证')
    expect(prompts).toHaveLength(2)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
    expect(managed.messages.find(m => m.role === 'error')?.content).toContain('未完成答案交付')
  })
  it('rejects duplicate submissions without replacing the committed answer', async () => {
    install(async function* () {
      await control!.submit(submission)
      await expect(control!.submit({ ...submission, markdown: '短句' })).rejects.toThrow('already')
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(managed.messages.filter(m => m.answerCommitted).map(m => m.content)).toEqual([markdown])
  })
  it('accepts at most one concurrent submission', async () => {
    install(async function* () {
      const first = control!.submit(submission)
      await expect(control!.submit({ ...submission, toolCallId: 'second', markdown: '重复正文' })).rejects.toThrow('already')
      await first
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
  })
  it('does not publish when the durable flush fails', async () => {
    install(async function* () {
      const flush = manager.flushSession.bind(manager)
      manager.flushSession = async () => { throw new Error('disk unavailable') }
      try { await expect(control!.submit(submission)).rejects.toThrow('disk unavailable') }
      finally { manager.flushSession = flush }
      yield { type: 'error', message: 'disk unavailable' }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(events.some(e => e.answerCommitted)).toBe(false)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
    expect(prompts).toHaveLength(1)
  })
  it('rejects outstanding tools before accepting an answer', async () => {
    install(async function* () {
      yield { type: 'tool_start', toolName: 'Bash', toolUseId: 'running', input: {} }
      await expect(control!.submit(submission)).rejects.toThrow('foreground')
      yield { type: 'tool_result', toolUseId: 'running', result: 'done', isError: false }
      await control!.submit(submission)
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
  })
  it('does not recover an errored turn', async () => {
    install(async function* () { yield { type: 'error', message: 'provider unavailable' }; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释')
    expect(prompts).toHaveLength(1)
  })
  it('does not recover a stopped turn or accept an obsolete submission', async () => {
    install(async function* () { managed.stopRequested = true; await expect(control!.submit(submission)).rejects.toThrow('no longer'); yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释')
    expect(prompts).toHaveLength(1)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
  })
  it('keeps worker and task output sessions on their existing protocol', async () => {
    managed.parentSessionId = 'parent'
    install(async function* () { expect(control).toBeUndefined(); yield { type: 'text_complete', text: 'worker result' }; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '执行子任务')
    expect(prompts).toHaveLength(1)
    expect(managed.messages.find(m => m.role === 'assistant')?.isIntermediate).toBeFalsy()
  })
  it('does not recover during plan/auth handoff', async () => {
    install(async function* () { managed.isProcessing = false; yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '先制定计划')
    expect(prompts).toHaveLength(1)
  })
  it('does not retry or accept delivery while waiting for Swarm workers', async () => {
    install(async function* () {
      managed.orchestrationStatus = 'running'
      managed.orchestrationAggregation = { phase: 'waiting-workers', orchestrationId: 'swarm' } as any
      managed.orchestrationId = 'swarm'
      await expect(control!.submit(submission)).rejects.toThrow('Swarm')
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '并行执行')
    expect(prompts).toHaveLength(1)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
  })
  it('does not start recovery after cancellation during its durable checkpoint', async () => {
    install(async function* () {
      const flush = manager.flushSession.bind(manager)
      manager.flushSession = async id => { await flush(id); managed.stopRequested = true }
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(prompts).toHaveLength(1)
  })
  it('does not publish an answer cancelled during persistence', async () => {
    install(async function* () {
      const flush = manager.flushSession.bind(manager)
      manager.flushSession = async id => { await flush(id); managed.stopRequested = true }
      await expect(control!.submit(submission)).rejects.toThrow('interrupted')
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(events.some(e => e.answerCommitted)).toBe(false)
    expect(managed.messages.some(m => m.answerCommitted)).toBe(false)
  })

  for (const recovery of [false, true]) {
    it(`commits a regenerated answer durably before publishing (recovery=${recovery})`, async () => {
      managed.messages = [
        { id: 'user', role: 'user', content: '解释', timestamp: 1 },
        { id: 'old', role: 'assistant', content: '旧答案', timestamp: 2 },
      ]
      managed.sdkSessionId = 'old-sdk'
      const originalMessages = structuredClone(managed.messages)
      managed.regenerateTransaction = { runId: 'regenerate', keepThroughMessageId: 'user', rendererTruncated: false, originalMessages, originalSdkSessionId: 'old-sdk' }
      let publishedSnapshot: ReturnType<typeof loadStoredSession> | undefined
      let transactionAtPublication: typeof managed.regenerateTransaction | undefined = managed.regenerateTransaction
      manager.setEventSink((_channel, _target, event: any) => {
        events.push(event)
        if (event.answerCommitted) {
          publishedSnapshot = loadStoredSession(root, managed.id)
          transactionAtPublication = managed.regenerateTransaction
        }
      })
      install(async function* (index) {
        managed.sdkSessionId = 'new-sdk'
        if (recovery && index === 1) yield { type: 'text_complete', text: '草稿' }
        else await control!.submit(submission)
        yield { type: 'complete' }
      })
      await manager.sendMessage(managed.id, '解释', undefined, undefined, undefined, 'user')
      expect(events.filter(e => e.answerCommitted)).toHaveLength(1)
      const published = events.find(e => e.answerCommitted)
      expect(publishedSnapshot?.messages.some(m => m.id === published.messageId && m.content === markdown)).toBe(true)
      expect(publishedSnapshot?.messages.some(m => m.id === 'old')).toBe(false)
      expect(publishedSnapshot?.sdkSessionId).toBe('new-sdk')
      expect(transactionAtPublication).toBeUndefined()
      expect(managed.messages.some(m => m.id === 'old')).toBe(false)
      expect(managed.messages.filter(m => m.answerCommitted)).toHaveLength(1)
      expect(originalMessages[0]?.answerRunId).toBeUndefined()
      expect(prompts).toHaveLength(recovery ? 2 : 1)
    })
  }
  it('reports a storage failure without asking the model to recover or retry submission', async () => {
    install(async function* () {
      const flush = manager.flushSession.bind(manager)
      manager.flushSession = async () => { throw new Error('disk unavailable') }
      try { await expect(control!.submit(submission)).rejects.toThrow('disk unavailable') }
      finally { manager.flushSession = flush }
      await expect(control!.submit(submission)).rejects.toThrow('persistence')
      yield { type: 'complete' }
    })
    await manager.sendMessage(managed.id, '解释')
    expect(prompts).toHaveLength(1)
    expect(managed.messages.filter(m => m.role === 'error').map(m => m.content).join()).toContain('保存失败')
    expect(managed.messages.some(m => m.content.includes('模型未提交完整正文'))).toBe(false)
  })

  for (const failure of ['cancel', 'readback'] as const) {
    it(`restores the original transcript and SDK identity after regenerate ${failure}`, async () => {
      managed.messages = [
        { id: 'user', role: 'user', content: '解释', timestamp: 1, answerRunId: 'old-run' },
        { id: 'old', role: 'assistant', content: '旧答案', timestamp: 2 },
      ]
      managed.sdkSessionId = 'old-sdk'
      install(async function* () {
        managed.sdkSessionId = 'new-sdk'
        const flush = manager.flushSession.bind(manager)
        let injected = false
        manager.flushSession = async id => {
          if (injected) return flush(id)
          injected = true
          if (failure === 'cancel') { await flush(id); managed.stopRequested = true }
          // Skip the candidate write to exercise the actual durable readback gate.
        }
        try { await expect(control!.submit(submission)).rejects.toThrow(failure === 'cancel' ? 'interrupted' : 'persisted') }
        finally { manager.flushSession = flush }
        yield { type: 'complete' }
      })
      await manager.regenerateLastResponse(managed.id)
      for (let i = 0; i < 200 && managed.isProcessing; i++) await new Promise(resolve => setTimeout(resolve, 5))
      expect(managed.isProcessing).toBe(false)
      await manager.flushSession(managed.id)
      const stored = loadStoredSession(root, managed.id)!
      expect(stored.sdkSessionId).toBe('old-sdk')
      expect(stored.messages.find(m => m.id === 'old')?.content).toBe('旧答案')
      expect(stored.messages.find(m => m.id === 'user')?.answerRunId).toBe('old-run')
      expect(stored.messages.some(m => m.answerCommitted)).toBe(false)
      expect(events.some(e => e.answerCommitted)).toBe(false)
      expect(prompts).toHaveLength(1)
    })
  }
  it('retains a durable answer when event publication fails', async () => {
    manager.setEventSink((_channel, _target, event: any) => {
      if (event.answerCommitted) throw new Error('window disconnected')
    })
    install(async function* () { await control!.submit(submission); yield { type: 'complete' } })
    await manager.sendMessage(managed.id, '解释')
    expect(loadStoredSession(root, managed.id)?.messages.filter(m => m.answerCommitted)).toHaveLength(1)
    expect(managed.messages.some(m => m.role === 'error')).toBe(false)
  })

  it('supports consecutive real regenerate entry calls and keeps committed output after a late stop', async () => {
    managed.messages = [
      { id: 'user', role: 'user', content: '解释', timestamp: 1 },
      { id: 'old', role: 'assistant', content: '旧答案', timestamp: 2 },
    ]
    const runIds: string[] = []
    install(async function* (index) {
      managed.sdkSessionId = `sdk-${index}`
      runIds.push(control!.runId)
      await control!.submit({ ...submission, markdown: `新答案 ${index}` })
      if (index === 2) managed.stopRequested = true
      yield { type: 'complete' }
    })
    for (let index = 1; index <= 2; index++) {
      await manager.regenerateLastResponse(managed.id)
      for (let i = 0; i < 200 && managed.isProcessing; i++) await new Promise(resolve => setTimeout(resolve, 5))
      expect(managed.isProcessing).toBe(false)
      await manager.flushSession(managed.id)
      const stored = loadStoredSession(root, managed.id)!
      expect(stored.messages.filter(m => m.answerCommitted).map(m => m.content)).toEqual([`新答案 ${index}`])
      expect(stored.sdkSessionId).toBe(`sdk-${index}`)
      const answer = managed.messages.find(m => m.answerCommitted)!
      expect((await loadPiTurnAnchors(getSessionPath(root, managed.id))).anchors[answer.id]).toBe(submission.sdkTurnAnchor)
    }
    expect(new Set(runIds).size).toBe(2)
    expect(events.filter(e => e.answerCommitted)).toHaveLength(2)
    expect(events.some(e => e.type === 'messages_restored')).toBe(false)
  })

})
