import { expect, test } from 'bun:test'
import { messageToStored, storedToMessage } from '../message-mapper'
import type { Message } from '../message'

test('task presentation survives persistence without replacing the model input or routing', () => {
  const message: Message = {
    id: 'task', role: 'user', timestamp: 1, content: 'Canonical execution identity: {"claims":[]}',
    taskContext: { kind: 'assignment', title: '核对成本资料', description: '保留资料限制' },
    answerRunId: 'run',
  }
  expect(storedToMessage(JSON.parse(JSON.stringify(messageToStored(message))))).toEqual(message)
})

test('answer routing survives persistence and JSON export/import without changing content', () => {
  for (const content of ['好', '# 解释\n提交答案是工具名。', '```ts\nconst x = 1\n```', '| A | B |\n|---|---|\n| 1 | 2 |', '> 引用\n\n[文件](C:/成果/报告.html)']) {
    const message: Message = {
      id: 'answer', role: 'assistant', timestamp: 1, content,
      answerProtocol: 'explicit-v1', answerRunId: 'run', answerRoutingVersion: 1,
      answerCommitted: true, answerSalvaged: true, toolPurpose: 'answer-delivery',
    }
    expect(storedToMessage(JSON.parse(JSON.stringify(messageToStored(message))))).toEqual(message)
  }
})

test('accepted feedback references survive reload and JSON transfer independently of annotations', () => {
  const message: Message = {
    id: 'request', role: 'user', timestamp: 2, content: 'Revise', clientMessageId: 'client',
    annotationFollowUps: [{ messageId: 'original', annotationId: 'note', text: 'Revise this', updatedAt: 1,
      sourceContentHash: 'hash', target: { source: { sessionId: 'session', messageId: 'original' }, selectors: [{ type: 'text-quote', exact: 'Selected text' }] },
    }],
  }
  const reloaded = storedToMessage(JSON.parse(JSON.stringify(messageToStored(message))))
  expect(reloaded).toEqual(message)
  expect(reloaded.annotationFollowUps?.[0]?.annotationId).toBe('note')
})
