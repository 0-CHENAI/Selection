import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { messageToStored, storedToMessage } from '@craft-agent/core'
import { countWorkRecords, getActiveTurnPreview, groupMessagesByTurn } from '../turn-utils'

const explanation = '蒙提霍尔问题：\n\n1. 三扇门中有一辆车。\n2. 主持人知道奖品位置，并打开一扇有羊的门。\n\n| 策略 | 胜率 |\n| --- | --- |\n| 不换 | 1/3 |\n| 换门 | 2/3 |'
const answer = `${explanation}\n\n模拟结果：换门胜率约为 2/3。`
const protocol = { answerProtocol: 'explicit-v1' as const, answerRunId: 'run-330' }
function transcript(): Message[] {
  return [
    { id: 'user', role: 'user', content: '解释蒙提霍尔问题并验证', timestamp: 1, ...protocol },
    { id: 'explanation', role: 'assistant', content: explanation, timestamp: 2, ...protocol },
    { id: 'simulation', role: 'tool', content: '', toolName: 'Bash', toolUseId: 'sim', toolStatus: 'completed', toolResult: '0.6667', timestamp: 3, ...protocol },
    { id: 'short', role: 'assistant', content: '模拟证实了结果。', timestamp: 4, ...protocol },
    { id: 'answer', role: 'assistant', content: answer, timestamp: 5, answerCommitted: true, ...protocol },
    { id: 'receipt', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'submit', toolStatus: 'completed', toolResult: 'Answer delivered.', timestamp: 6, ...protocol },
    { id: 'late', role: 'assistant', content: '已完成。', timestamp: 7, ...protocol },
  ] as Message[]
}
describe('explicit answer delivery (#330)', () => {
  it('keeps the complete answer through receipts, late text and reload', () => {
    for (const messages of [transcript(), transcript().map(messageToStored).map(storedToMessage)]) {
      const turns = groupMessagesByTurn(messages).filter(t => t.type === 'assistant')
      expect(turns).toHaveLength(1)
      expect(turns[0]?.response?.text).toBe(answer)
      expect(turns[0]?.response?.messageId).toBe('answer')
      expect(turns[0]?.isComplete).toBe(true)
      expect(turns[0]?.activities.some(a => a.toolUseId === 'sim')).toBe(true)
    }
  })
  it('keeps short uncommitted notes in the work chain until submit_answer', () => {
    const turns = groupMessagesByTurn(transcript().slice(0, 4)).filter(t => t.type === 'assistant')
    expect(turns).toHaveLength(1)
    expect(turns[0]?.response).toBeUndefined()
    expect(turns[0]?.isComplete).toBe(false)
    expect(turns[0]?.activities.some(a => a.content === explanation)).toBe(true)
    expect(turns[0]?.activities.some(a => a.content === '模拟证实了结果。')).toBe(true)
  })

  it('keeps the explicit draft on the card between text completion and answer delivery', () => {
    const draft = '知道了，这是 DeepSeek 在2026年9月10日正式发布的模型（属于全新架构系列里尺寸最小的一款）。我查了官方公告和 Hugging Face。'
    const answer = '# DeepSeek V4.1 Flash\n\n2026 年 9 月 10 日发布，是新架构系列中最小的一款。'
    const streaming: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isStreaming: true, isPending: true, isIntermediate: true, ...protocol },
    ]
    const live = groupMessagesByTurn(streaming, { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(live.response).toMatchObject({ text: draft, isStreaming: true })
    expect(live.activities.some(a => a.type === 'intermediate')).toBe(false)

    const finished = groupMessagesByTurn([
      ...streaming.slice(0, 2),
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isIntermediate: true, ...protocol },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(finished.response).toMatchObject({ text: draft, isCommentary: true, isStreaming: false })
    expect(finished.isComplete).toBe(false)
    expect(finished.activities.some(a => a.content === draft)).toBe(false)

    const committed = groupMessagesByTurn([
      ...streaming.slice(0, 2),
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isIntermediate: true, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: 'completed', toolResult: 'Answer delivered.', timestamp: 4, ...protocol },
      { id: 'answer', role: 'assistant', content: answer, timestamp: 5, answerCommitted: true, ...protocol },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(committed.response?.text).toBe(answer)
    expect(committed.activities.some(a => a.id === 'draft')).toBe(true)
  })

  it('places completed text by isIntermediate / answerCommitted, not by length', () => {
    const draft = 'Ponytail(ponytail) 是一个“最懒方案”编码风格技能——它强制 AI 用最简单、最短、最小的可行方案来写代码。'
    const commentary = groupMessagesByTurn([
      { id: 'user', role: 'user', content: '这个技能是做什么的', timestamp: 1 },
      { id: 'read', role: 'tool', content: '', toolName: 'Read', toolUseId: 'rd', toolStatus: 'completed', toolResult: '…', timestamp: 2 },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isIntermediate: true },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(commentary.response).toBeUndefined()
    expect(commentary.activities.some(a => a.content === draft)).toBe(true)

    const final = groupMessagesByTurn([
      { id: 'user', role: 'user', content: '这个技能是做什么的', timestamp: 1 },
      { id: 'read', role: 'tool', content: '', toolName: 'Read', toolUseId: 'rd', toolStatus: 'completed', toolResult: '…', timestamp: 2 },
      { id: 'answer', role: 'assistant', content: draft, timestamp: 3, isIntermediate: false },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(final.response).toMatchObject({ text: draft })
    expect(final.activities.some(a => a.content === draft)).toBe(false)

    const committed = groupMessagesByTurn([
      { id: 'user', role: 'user', content: '这个技能是做什么的', timestamp: 1, ...protocol },
      { id: 'read', role: 'tool', content: '', toolName: 'Read', toolUseId: 'rd', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'answer', role: 'assistant', content: draft, timestamp: 3, answerCommitted: true, ...protocol },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(committed.response).toMatchObject({ text: draft })
    expect(committed.activities.some(a => a.content === draft)).toBe(false)
  })

  it('places live tokens by phase / protocol fields, not by whether tools already ran', () => {
    const draft = 'Ponytail 用来约束实现复杂度。'
    const leftover = groupMessagesByTurn([
      { id: 'user', role: 'user', content: '这个技能是做什么的', timestamp: 1 },
      // Native live text as handleTextDelta emits it: unclassified, not flagged intermediate.
      { id: 'draft', role: 'assistant', content: draft, timestamp: 2, isStreaming: true, isPending: true, isIntermediate: false, phase: 'unclassified' },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(leftover.response).toMatchObject({ text: draft, isStreaming: true })
    expect(leftover.activities.some(a => a.type === 'intermediate')).toBe(false)

    // A legacy sender that only sets isIntermediate (no phase) is process text even while live.
    const legacy = groupMessagesByTurn([
      { id: 'user', role: 'user', content: '这个技能是做什么的', timestamp: 1 },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 2, isStreaming: true, isPending: true, isIntermediate: true },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(legacy.response).toBeUndefined()
    expect(legacy.activities.some(a => a.type === 'intermediate' && a.content === draft)).toBe(true)

    const commentary = groupMessagesByTurn([
      { id: 'user', role: 'user', content: '这个技能是做什么的', timestamp: 1 },
      { id: 'read', role: 'tool', content: '', toolName: 'Read', toolUseId: 'rd', toolStatus: 'completed', toolResult: '…', timestamp: 2 },
      { id: 'note', role: 'assistant', content: '我先读技能说明。', timestamp: 3, isStreaming: true, isPending: true, isIntermediate: true, phase: 'intermediate' },
    ], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(commentary.response).toBeUndefined()
    expect(commentary.activities.some(a => a.content === '我先读技能说明。')).toBe(true)
  })

  it('does not add a work-chain step for the first streamed token after tools', () => {
    const tools: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 's1', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws1', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 's2', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws2', toolStatus: 'completed', toolResult: '…', timestamp: 3, ...protocol },
      { id: 'f1', role: 'tool', content: '', toolName: 'WebFetch', toolUseId: 'wf1', toolStatus: 'completed', toolResult: '…', timestamp: 4, ...protocol },
    ]
    for (const draft of [
      { id: 'draft', role: 'assistant' as const, content: '知', timestamp: 5, isStreaming: true, isPending: true, isIntermediate: true, ...protocol },
      { id: 'draft', role: 'assistant' as const, content: '知', timestamp: 5, isStreaming: true, isPending: true, isIntermediate: false, phase: 'unclassified' as const },
    ]) {
      const turn = groupMessagesByTurn([...tools, draft], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
      expect(turn.response).toMatchObject({ text: '知', isStreaming: true })
      expect(turn.activities.some(a => a.type === 'intermediate')).toBe(false)
      expect(countWorkRecords(turn.activities)).toBe(3)
    }
  })

  it('streams uncommitted explicit text on the card after tools, not a thought row', () => {
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'draft', role: 'assistant', content: '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。', timestamp: 3, isStreaming: true, isPending: true, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response).toMatchObject({
      text: '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。',
      isStreaming: true,
    })
    expect(turn.activities.some(a => a.type === 'intermediate')).toBe(false)
  })

  it('keeps completed uncommitted explicit text in the work chain when more tools start', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, ...protocol },
      { id: 'read', role: 'tool', content: '', toolName: 'WebFetch', toolUseId: 'wf', toolStatus: undefined, timestamp: 4, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response).toBeUndefined()
    expect(turn.activities.some(a => a.content === draft)).toBe(true)
    expect(turn.activities.some(a => a.toolUseId === 'wf')).toBe(true)
  })

  it('keeps a streaming draft on the card when more tools start', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isStreaming: true, isPending: true, ...protocol },
      { id: 'read', role: 'tool', content: '', toolName: 'WebFetch', toolUseId: 'wf', toolStatus: undefined, timestamp: 4, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response).toMatchObject({ text: draft, isStreaming: true })
    expect(turn.activities.some(a => a.content === draft)).toBe(false)
    expect(turn.activities.some(a => a.toolUseId === 'wf')).toBe(true)
  })

  it('demotes a short process note when more business tools start', () => {
    const note = '我先再查一下。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'note', role: 'assistant', content: note, timestamp: 3, ...protocol },
      { id: 'read', role: 'tool', content: '', toolName: 'WebFetch', toolUseId: 'wf', toolStatus: undefined, timestamp: 4, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response).toBeUndefined()
    expect(turn.activities.some(a => a.content === note)).toBe(true)
    expect(turn.activities.some(a => a.toolUseId === 'wf')).toBe(true)
  })

  it('does not put the submit_answer receipt on the card; salvages the draft if commit never arrives', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isIntermediate: true, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: 'completed', toolResult: 'Answer delivered. Stop here.', timestamp: 4, ...protocol },
      { id: 'receipt', role: 'assistant', content: 'Answer delivered. Stop here.', timestamp: 5 },
    ]
    const turn = groupMessagesByTurn(messages, { isSessionProcessing: false }).find(t => t.type === 'assistant')!
    expect(turn.response?.text).toBe(draft)
    expect(turn.activities.some(a => a.type === 'intermediate' && a.content?.includes('Answer delivered'))).toBe(false)
    expect(turn.activities.some(a => a.toolName === 'submit_answer')).toBe(false)
    expect(turn.answerDelivered).toBe(true)
  })

  it('does not close the run when a committed receipt is already in the transcript', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isIntermediate: true, ...protocol },
      { id: 'fake-commit', role: 'assistant', content: 'Answer delivered. Stop here.', timestamp: 4, answerCommitted: true, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: 'completed', toolResult: 'Answer delivered. Stop here.', timestamp: 5, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages, { isSessionProcessing: false }).find(t => t.type === 'assistant')!
    expect(turn.response?.text).toBe(draft)
    expect(turn.answerDelivered).toBe(true)
  })

  it('keeps a live uncommitted stream on the card after submit_answer completes', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: 'completed', toolResult: 'Answer delivered. Stop here.', timestamp: 3, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 4, isStreaming: true, isPending: true, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages, { isSessionProcessing: true }).find(t => t.type === 'assistant')!
    expect(turn.response).toMatchObject({ text: draft, isStreaming: true })
    expect(turn.activities.some(a => a.toolName === 'submit_answer')).toBe(false)
  })

  it('drops untagged assistant text after a successful submit_answer instead of treating it as a native final', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 3, isIntermediate: true, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: 'completed', toolResult: 'Answer delivered. Stop here.', timestamp: 4, ...protocol },
      { id: 'echo', role: 'assistant', content: '随便一句未交付的收尾。', timestamp: 5 },
    ]
    const turn = groupMessagesByTurn(messages, { isSessionProcessing: false }).find(t => t.type === 'assistant')!
    expect(turn.response?.text).toBe(draft)
    expect(turn.activities.some(a => a.content === '随便一句未交付的收尾。')).toBe(false)
    expect(turn.answerDelivered).toBe(true)
  })

  it('does not salvage a draft after submit_answer fails', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 2, isIntermediate: true, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: 'completed', isError: true, toolResult: 'Submit the Markdown answer itself, not the delivery receipt.', timestamp: 3, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages, { isSessionProcessing: false }).find(t => t.type === 'assistant')!
    expect(turn.response).toBeUndefined()
    expect(turn.answerDelivered).toBeUndefined()
    expect(turn.activities.some(a => a.content === draft)).toBe(true)
  })

  it('keeps completed uncommitted text in the work chain when submit_answer starts', () => {
    const draft = '知道了，DeepSeek V4.1 Flash 是新架构系列中最小的一款。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'draft', role: 'assistant', content: draft, timestamp: 2, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: undefined, timestamp: 3, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response).toBeUndefined()
    expect(turn.activities.some(a => a.content === draft)).toBe(true)
    expect(turn.activities.some(a => a.toolName === 'submit_answer')).toBe(false)
    expect(countWorkRecords(turn.activities)).toBe(1)
  })

  it('does not add submit_answer to the work chain after real tools', () => {
    const answer = '# DeepSeek V4.1 Flash\n\n2026 年 9 月 10 日发布。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '介绍', timestamp: 1, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 2, ...protocol },
      { id: 'submit', role: 'tool', content: '', toolName: 'submit_answer', toolUseId: 'sa', toolStatus: 'completed', toolDisplayName: 'Submit V4.1 Flash Research', toolIntent: '提交正式回复', toolResult: 'Answer delivered. Stop here.', timestamp: 3, ...protocol },
      { id: 'answer', role: 'assistant', content: answer, timestamp: 4, answerCommitted: true, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response?.text).toBe(answer)
    expect(turn.activities.some(a => a.toolName === 'submit_answer')).toBe(false)
    expect(turn.activities.some(a => a.displayName === 'Submit V4.1 Flash Research')).toBe(false)
    expect(countWorkRecords(turn.activities)).toBe(1)
    expect(getActiveTurnPreview(turn.activities, 'awaiting')).not.toContain('正式回复')
    expect(getActiveTurnPreview(turn.activities, 'awaiting')).not.toContain('Submit V4.1')
  })
  it('does not assemble superseded explanations into the committed answer', () => {
    const messages = transcript()
    messages[4]!.content = '修正：主持人随机开门的条件不同，不能直接使用上述结论。'
    expect(groupMessagesByTurn(messages).find(t => t.type === 'assistant')?.response?.text).toBe(messages[4]!.content)
  })
  it('folds commentary that drafted the committed answer into the final card', () => {
    const committed = '直接说结论：没有绝对的胜负，要看你的工作负载。\n\n详细对比……'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '对比两个模型', timestamp: 1, ...protocol },
      { id: 'note', role: 'assistant', content: '我来查一下资料。', timestamp: 2, ...protocol },
      { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolUseId: 'ws', toolStatus: 'completed', toolResult: '…', timestamp: 3, ...protocol },
      { id: 'draft', role: 'assistant', content: '直接说结论：没有绝对的胜负，要看你的工作负载。', timestamp: 4, ...protocol },
      { id: 'answer', role: 'assistant', content: committed, timestamp: 5, answerCommitted: true, ...protocol },
    ]
    for (const variant of [messages, messages.map(messageToStored).map(storedToMessage)]) {
      const turn = groupMessagesByTurn(variant).find(t => t.type === 'assistant')!
      expect(turn.response?.text).toBe(committed)
      expect(turn.activities.some(a => a.content === '我来查一下资料。')).toBe(true)
      expect(turn.activities.some(a => a.id === 'draft')).toBe(false)
    }
  })
  it('keeps tiny commentary that merely prefixes the committed answer', () => {
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '继续', timestamp: 1, ...protocol },
      { id: 'ack', role: 'assistant', content: '好', timestamp: 2, ...protocol },
      { id: 'answer', role: 'assistant', content: '好的，以下是完整说明。', timestamp: 3, answerCommitted: true, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response?.text).toBe('好的，以下是完整说明。')
    expect(turn.activities.some(a => a.id === 'ack')).toBe(true)
  })
  it('folds commentary that carries a superseded draft of the committed answer', () => {
    const committed = '# 对比结论\n\n最终修订后的正文。'
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '对比两个模型', timestamp: 1, ...protocol },
      { id: 'stale-draft', role: 'assistant', content: '我已经拿到了足够的信息。\n\n# 对比结论\n\n被改写的旧草稿。', timestamp: 2, ...protocol },
      { id: 'answer', role: 'assistant', content: committed, timestamp: 3, answerCommitted: true, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.response?.text).toBe(committed)
    expect(turn.activities.some(a => a.id === 'stale-draft')).toBe(false)
  })
  it('keeps commentary when the committed answer heading differs', () => {
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '对比两个模型', timestamp: 1, ...protocol },
      { id: 'note', role: 'assistant', content: '查完了，下面给出结论。', timestamp: 2, ...protocol },
      { id: 'answer', role: 'assistant', content: '# 对比结论\n\n最终正文。', timestamp: 3, answerCommitted: true, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.activities.some(a => a.id === 'note')).toBe(true)
  })
  it('keeps legacy behavior for messages without protocol metadata', () => {
    const messages: Message[] = [{ id: 'legacy', role: 'assistant', content: '旧答案', timestamp: 1 }]
    expect(groupMessagesByTurn(messages)[0]).toMatchObject({ response: { text: '旧答案' } })
  })
  it('does not fold an accepted answer when orchestration status arrives late', () => {
    const messages = transcript()
    messages[2] = { ...messages[2]!, toolName: 'spawn_session', toolResult: JSON.stringify({ status: 'started', spawnReason: 'automatic', lifecycle: 'managed' }) }
    for (const options of [{ isManagedSwarmRunning: true }, { isTaskOrchestrationRunning: true }, { isManagedSwarmRunning: true, isTaskOrchestrationRunning: true }]) {
      const turn = groupMessagesByTurn(messages, options).find(t => t.type === 'assistant')!
      expect(turn.response?.text).toBe(answer)
      expect(turn.isComplete).toBe(true)
      expect(turn.isStreaming).toBe(false)
    }
  })
  it('still keeps a later undelivered orchestration turn open', () => {
    const messages: Message[] = [...transcript(),
      { id: 'new-user', role: 'user', content: '继续检查', timestamp: 8, answerProtocol: 'explicit-v1', answerRunId: 'new-run' },
      { id: 'new-tool', role: 'tool', content: '', toolName: 'spawn_session', toolStatus: 'completed', toolResult: JSON.stringify({ status: 'started', spawnReason: 'automatic', lifecycle: 'managed' }), timestamp: 9, answerProtocol: 'explicit-v1', answerRunId: 'new-run' },
    ]
    const turns = groupMessagesByTurn(messages, { isManagedSwarmRunning: true, isTaskOrchestrationRunning: true }).filter(t => t.type === 'assistant')
    expect(turns[0]?.response?.text).toBe(answer)
    expect(turns[1]?.response).toBeUndefined()
    expect(turns[1]?.isComplete).toBe(false)
    expect(turns[1]?.isStreaming).toBe(true)
  })
})

it('keeps a later explicit delivery run separate, even after a hidden wake', () => {
  const messages: Message[] = [...transcript(),
    { id: 'wake', role: 'user', hidden: true, content: '后台工作完成', timestamp: 8, answerProtocol: 'explicit-v1', answerRunId: 'next-run' },
    { id: 'next-tool', role: 'tool', content: '', toolName: 'Read', toolStatus: 'completed', toolResult: '完成', timestamp: 9, answerProtocol: 'explicit-v1', answerRunId: 'next-run' },
    { id: 'next-answer', role: 'assistant', content: '后台结果', timestamp: 10, answerProtocol: 'explicit-v1', answerRunId: 'next-run', answerCommitted: true },
  ]
  const turns = groupMessagesByTurn(messages).filter(t => t.type === 'assistant')
  expect(turns.map(t => t.response?.text)).toEqual([answer, '后台结果'])
})

it('never promotes an undelivered answer when processing stops', () => {
  const turns = groupMessagesByTurn(transcript().slice(0, 4), { isSessionProcessing: false }).filter(t => t.type === 'assistant')
  expect(turns[0]?.response).toBeUndefined()
  expect(turns[0]?.activities.some(a => a.content === explanation)).toBe(true)
  expect(turns[0]?.activities.some(a => a.content === '模拟证实了结果。')).toBe(true)
})


it('keeps process notes that only mention the answer heading, or contain it inside code', () => {
  const heading = '# 对比结论'
  for (const note of [
    '接下来会使用标题 "# 对比结论"，目前还在查证。',
    '# 对比结论的验证计划\n\n仍需查证实际指标。',
    '检查模板示例：\n\n```markdown\n# 对比结论\n这里是占位符。\n```',
    '    # 对比结论\n    这是缩进代码示例。',
    '> # 对比结论\n> 这是引用的文档标题。',
    '<pre>\n# 对比结论\n这是 HTML 代码示例。\n</pre>',
  ]) {
    const messages: Message[] = [
      { id: 'user', role: 'user', content: '对比', timestamp: 1, ...protocol },
      { id: 'note', role: 'assistant', content: note, timestamp: 2, ...protocol },
      { id: 'answer', role: 'assistant', content: heading + '\n\n最终正文。', timestamp: 3, answerCommitted: true, ...protocol },
    ]
    const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
    expect(turn.activities.some(a => a.id === 'note')).toBe(true)
    expect(turn.response?.text).toBe(heading + '\n\n最终正文。')
  }
})


it('does not fold a draft against an invisible committed message', () => {
  const messages: Message[] = [
    { id: 'user', role: 'user', content: '对比', timestamp: 1, ...protocol },
    { id: 'draft', role: 'assistant', content: '# 对比结论\n\n正在查证。', timestamp: 2, ...protocol },
    { id: 'hidden-answer', role: 'assistant', hidden: true, content: '# 对比结论\n\n不可见的内部答案。', timestamp: 3, answerCommitted: true, ...protocol },
  ]
  const turn = groupMessagesByTurn(messages).find(t => t.type === 'assistant')!
  expect(turn.activities.some(a => a.id === 'draft')).toBe(true)
  expect(turn.response).toBeUndefined()
})

it('reserves only the active unclassified tail without mutating stored messages', () => {
  const user: Message = { id: 'u', role: 'user', content: '研究', timestamp: 1, ...protocol }
  const draft: Message = { id: 'draft', role: 'assistant', content: explanation, timestamp: 2, isIntermediate: true, phase: 'unclassified', ...protocol }
  const snapshot = JSON.stringify(draft)
  const active = groupMessagesByTurn([user, draft], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
  expect(active.response?.text).toBe(explanation)
  expect(active.isComplete).toBe(false)
  expect(JSON.stringify(draft)).toBe(snapshot)
  for (const processing of [false, undefined]) {
    const stopped = groupMessagesByTurn([user, draft], { isSessionProcessing: processing }).find(t => t.type === 'assistant')!
    expect(stopped.response).toBeUndefined()
  }
  const commentary = groupMessagesByTurn([user, { ...draft, phase: 'intermediate' }], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
  expect(commentary.response).toBeUndefined()
  const tool: Message = { id: 'tool', role: 'tool', content: '', toolName: 'WebFetch', toolUseId: 'fetch', toolStatus: 'executing', timestamp: 3, ...protocol }
  const resumed = groupMessagesByTurn([user, draft, tool], { isSessionProcessing: true }).find(t => t.type === 'assistant')!
  expect(resumed.response).toBeUndefined()
  expect(resumed.activities.some(a => a.content === explanation)).toBe(true)
})

it('shows a marker-v1 final after regenerating a user message from an explicit-v1 run', () => {
  const body = '是真的。\n\n## 官方说了什么\n\n正文与数据表。'
  const messages: Message[] = [
    { id: 'user', role: 'user', content: 'Grok 4.7 的反馈如何？', timestamp: 1, ...protocol },
    { id: 'progress', role: 'assistant', content: '我去看官方说明。', timestamp: 2, isIntermediate: true, phase: 'intermediate', presentationProtocol: 'marker-v1' },
    { id: 'search', role: 'tool', content: '', toolName: 'WebSearch', toolStatus: 'completed', toolResult: '找到来源', timestamp: 3 },
    { id: 'final', role: 'assistant', content: body, timestamp: 4, isIntermediate: false, phase: 'final', presentationProtocol: 'marker-v1' },
  ]
  for (const transcript of [messages, messages.map(messageToStored).map(storedToMessage)]) {
    for (const isSessionProcessing of [true, false]) {
      const turn = groupMessagesByTurn(transcript, { isSessionProcessing }).find(t => t.type === 'assistant')!
      expect(turn.response?.text).toBe(body)
      expect(turn.response?.messageId).toBe('final')
      expect(turn.answerRunId).toBeUndefined()
      expect(turn.activities.some(activity => activity.content === body)).toBe(false)
      expect(turn.activities.some(activity => activity.content === '我去看官方说明。')).toBe(true)
    }
  }
})
