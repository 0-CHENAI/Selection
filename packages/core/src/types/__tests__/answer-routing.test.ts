import { expect, test } from 'bun:test'
import { messageToStored, storedToMessage } from '../message-mapper'
import type { Message } from '../message'

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
