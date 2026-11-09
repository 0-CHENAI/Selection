import { expect, test } from 'bun:test'
import { officePreviewRefreshFailure } from './office-preview-refresh'

test('preview refresh distinguishes unsupported hosts, expired processes and transient writes', () => {
  expect(officePreviewRefreshFailure(new Error('RPC: Unknown Office preview operation'))).toBe('restart')
  expect(officePreviewRefreshFailure('Office preview is unavailable')).toBe('restart')
  expect(officePreviewRefreshFailure(new Error('预览已关闭或过期，请重新打开'))).toBe('reopen')
  expect(officePreviewRefreshFailure(new Error('预览已休眠，请返回会话后重试'))).toBe('reopen')
  expect(officePreviewRefreshFailure(new Error('invalid zip data'))).toBe('retry')
  expect(officePreviewRefreshFailure(new Error('network disconnected'))).toBe('retry')
})
