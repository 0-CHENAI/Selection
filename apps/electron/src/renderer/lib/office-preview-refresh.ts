/** Only transient writes should retry against the same preview identifier. */
export function officePreviewRefreshFailure(error: unknown): 'restart' | 'reopen' | 'retry' {
  const message = error instanceof Error ? error.message : String(error)
  if (/Unknown Office preview operation|Office preview is unavailable/i.test(message)) return 'restart'
  if (/预览已关闭或过期|预览已休眠/.test(message)) return 'reopen'
  return 'retry'
}
