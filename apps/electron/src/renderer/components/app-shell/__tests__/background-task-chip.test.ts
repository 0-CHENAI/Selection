import { describe, expect, it } from 'bun:test'
import {
  resolveBackgroundTaskChipLabel,
  shouldPreviewBackgroundTask,
  TASK_CHIP_WIDTH_CLASS,
} from '../background-task-chip'

describe('resolveBackgroundTaskChipLabel', () => {
  it('prefers a short session title over the prompt-sized intent', () => {
    expect(resolveBackgroundTaskChipLabel({
      taskId: 'sess-hy4-preview-aaaaaaaa',
      intent: '请使用 web_search 和 web_fetch 工具调研 Hy4-preview 的最新信息。',
      sessionName: '调研 Hy4-preview',
    })).toBe('调研 Hy4-preview')
  })

  it('uses a short spawn name stored as intent', () => {
    expect(resolveBackgroundTaskChipLabel({
      taskId: 'sess-1',
      intent: '调研 GLM5.3',
    })).toBe('调研 GLM5.3')
  })

  it('does not put a long prompt on the chip', () => {
    expect(resolveBackgroundTaskChipLabel({
      taskId: 'sess-abcdef123456',
      intent: '请使用 web_search 和 web_fetch 工具调研这三个模型的最新信息。',
    })).toBe('sess-abc...')
  })

  it('keeps a long title and lets the chip truncate it', () => {
    expect(resolveBackgroundTaskChipLabel({
      taskId: 'sess-1',
      sessionName: '对比 Hy4-preview 与 GLM5.3 的最新公开评测',
    })).toBe('对比 Hy4-preview 与 GLM5.3 的最新公开评测')
  })

  it('falls back to a shortened id when unnamed', () => {
    expect(resolveBackgroundTaskChipLabel({ taskId: 'sess-abcdef123456' })).toBe('sess-abc...')
  })
})

describe('shouldPreviewBackgroundTask', () => {
  it('previews running and stale agent chips', () => {
    expect(shouldPreviewBackgroundTask({ type: 'agent', status: 'running' })).toBe(true)
    expect(shouldPreviewBackgroundTask({ type: 'agent', status: 'stale' })).toBe(true)
  })

  it('navigates completed agents and ignores shells', () => {
    expect(shouldPreviewBackgroundTask({ type: 'agent', status: 'completed' })).toBe(false)
    expect(shouldPreviewBackgroundTask({ type: 'shell', status: 'running' })).toBe(false)
  })
})

describe('task chip width', () => {
  it('uses a shared default width class', () => {
    expect(TASK_CHIP_WIDTH_CLASS).toBe('w-[220px]')
  })
})
