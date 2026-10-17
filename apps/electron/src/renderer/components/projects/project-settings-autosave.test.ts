import { describe, expect, it } from 'bun:test'
import { projectSettingsDraftFromConfig, type ProjectSettingsDraft } from './project-settings-draft'
import {
  PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS,
  ProjectSettingsAutosaveController,
  projectAutosaveNoticeBlur,
  projectAutosaveNoticeFocus,
  projectAutosaveNoticeSuccess,
  projectSettingsAutosaveDelay,
  projectSettingsNeedsSave,
  projectSettingsPatch,
  projectSettingsPersistableDraft,
  createProjectAutosaveNotice,
} from './project-settings-autosave'

const stored = projectSettingsDraftFromConfig({
  name: '巡察',
  description: '旧说明',
  workingDirectory: '/data/巡察',
  details: '注明页码',
  historySearchEnabled: false,
  color: '#111111',
})

function draft(patch: Partial<ProjectSettingsDraft> = {}): ProjectSettingsDraft {
  return { ...stored, ...patch }
}

describe('project settings autosave decisions', () => {
  it('saves switches and folder changes immediately, and debounces text and color', () => {
    expect(projectSettingsAutosaveDelay(stored, draft({ historySearch: true }))).toBe(0)
    expect(projectSettingsAutosaveDelay(stored, draft({ workingDirectory: '/data/new' }))).toBe(0)
    expect(projectSettingsAutosaveDelay(stored, draft({ details: '新指令' }))).toBe(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS)
    expect(projectSettingsAutosaveDelay(stored, draft({ name: '巡察二期' }))).toBe(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS)
    expect(projectSettingsAutosaveDelay(stored, draft({ description: '新说明' }))).toBe(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS)
    expect(projectSettingsAutosaveDelay(stored, draft({ color: '#222222' }))).toBe(PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS)
    expect(projectSettingsAutosaveDelay(stored, draft())).toBeNull()
  })

  it('does not treat an empty name, a cleared folder, or trailing space as a new write', () => {
    expect(projectSettingsNeedsSave(stored, draft({ name: '   ' }))).toBe(false)
    expect(projectSettingsNeedsSave(stored, draft({ workingDirectory: '  ' }))).toBe(false)
    expect(projectSettingsNeedsSave(stored, draft({ details: '注明页码  ' }))).toBe(false)
    expect(projectSettingsPersistableDraft(stored, draft({ name: '  ', details: ' 新指令 ' }))).toMatchObject({
      name: '巡察',
      details: '新指令',
      workingDirectory: '/data/巡察',
    })
    expect(projectSettingsPatch(projectSettingsPersistableDraft(stored, draft({ description: '  ' })))).toMatchObject({
      name: '巡察',
      description: undefined,
      historySearchEnabled: false,
    })
  })

  it('toasts once for a text session and again for each discrete change', () => {
    let notice = createProjectAutosaveNotice()
    notice = projectAutosaveNoticeFocus(notice)
    const first = projectAutosaveNoticeSuccess(notice)
    notice = first.state
    expect(first.toast).toBe(true)
    expect(projectAutosaveNoticeSuccess(notice).toast).toBe(false)
    notice = projectAutosaveNoticeBlur(notice)
    notice = projectAutosaveNoticeFocus(notice)
    expect(projectAutosaveNoticeSuccess(notice).toast).toBe(true)

    const toggle = projectAutosaveNoticeSuccess(createProjectAutosaveNotice())
    expect(toggle.toast).toBe(true)
    expect(projectAutosaveNoticeSuccess(toggle.state).toast).toBe(true)
  })
})

describe('project settings autosave controller', () => {
  function harness() {
    const writes: Array<{ draft: ProjectSettingsDraft; slug?: string }> = []
    const success: string[] = []
    const errors: unknown[] = []
    let slug = 'xuncha'
    let gate: { resolve: () => void; promise: Promise<void> } | null = null
    const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = []
    const focusQueue: Array<() => void> = []
    let now = 0
    const ctrl = new ProjectSettingsAutosaveController({
      delayMs: PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS,
      capture: () => ({ slug, workspaceId: 'ws' }),
      persist: async (next, context) => {
        const pending = gate
        if (pending) await pending.promise
        writes.push({ draft: next, slug: context.slug })
        return 'saved'
      },
      onSuccess: () => { success.push('ok') },
      onError: (error) => { errors.push(error) },
      schedule: (fn, delay) => {
        const timer = { at: now + delay, fn, cancelled: false }
        timers.push(timer)
        return { cancel: () => { timer.cancelled = true } }
      },
      deferFocus: (fn) => { focusQueue.push(fn) },
    })
    ctrl.syncServer(stored, stored)
    return {
      ctrl,
      writes,
      success,
      errors,
      setSlug: (next: string) => { slug = next },
      hold() {
        let resolve!: () => void
        const promise = new Promise<void>((done) => { resolve = done })
        gate = { resolve, promise }
      },
      release() {
        gate?.resolve()
        gate = null
      },
      advance(ms: number) {
        now += ms
        for (;;) {
          const due = timers
            .filter((timer) => !timer.cancelled && timer.at <= now)
            .sort((left, right) => left.at - right.at)[0]
          if (!due) return
          due.cancelled = true
          due.fn()
        }
      },
      settleFocus() {
        const queued = focusQueue.splice(0)
        for (const fn of queued) fn()
      },
    }
  }

  it('debounces instructions and resets the wait while typing', async () => {
    const env = harness()
    env.ctrl.focusText()
    env.ctrl.setDraft(draft({ details: '一' }))
    env.advance(799)
    expect(env.writes).toHaveLength(0)
    env.ctrl.setDraft(draft({ details: '一二' }))
    env.advance(799)
    expect(env.writes).toHaveLength(0)
    env.advance(1)
    await env.ctrl.idle()
    expect(env.writes.map((write) => write.draft.details)).toEqual(['一二'])
    expect(env.success).toEqual(['ok'])
  })

  it('saves on blur immediately and keeps one toast for the same editing session', async () => {
    const env = harness()
    env.ctrl.focusText()
    env.ctrl.setDraft(draft({ details: '第一句' }))
    env.advance(800)
    await env.ctrl.idle()
    env.ctrl.setDraft(draft({ details: '第一句。第二句' }))
    env.ctrl.blurText()
    await env.ctrl.idle()
    env.settleFocus()
    expect(env.writes.map((write) => write.draft.details)).toEqual(['第一句', '第一句。第二句'])
    expect(env.success).toEqual(['ok'])
  })

  it('starts a new toast after the text session ends', async () => {
    const env = harness()
    env.ctrl.focusText()
    env.ctrl.setDraft(draft({ name: '巡察二期' }))
    env.ctrl.blurText()
    await env.ctrl.idle()
    env.settleFocus()
    env.ctrl.focusText()
    env.ctrl.setDraft(draft({ name: '巡察三期' }))
    env.ctrl.blurText()
    await env.ctrl.idle()
    expect(env.success).toEqual(['ok', 'ok'])
  })

  it('does not split a toast when focus moves between text fields', async () => {
    const env = harness()
    env.ctrl.focusText()
    env.ctrl.setDraft(draft({ name: '巡察二期' }))
    env.advance(800)
    await env.ctrl.idle()
    env.ctrl.blurText()
    env.ctrl.focusText()
    env.settleFocus()
    env.ctrl.setDraft(draft({ name: '巡察二期', description: '新说明' }))
    env.advance(800)
    await env.ctrl.idle()
    expect(env.success).toEqual(['ok'])
  })

  it('saves a switch and a picked folder without waiting', async () => {
    const env = harness()
    env.ctrl.setDraft(draft({ historySearch: true }))
    await env.ctrl.idle()
    env.ctrl.setDraft(draft({ historySearch: true, workingDirectory: '/data/new' }))
    await env.ctrl.idle()
    expect(env.writes.map((write) => [write.draft.historySearch, write.draft.workingDirectory])).toEqual([
      [true, '/data/巡察'],
      [true, '/data/new'],
    ])
    expect(env.success).toEqual(['ok', 'ok'])
  })

  it('keeps the draft and reports an error without a success toast', async () => {
    const writes: ProjectSettingsDraft[] = []
    let fail = true
    const errors: unknown[] = []
    const success: string[] = []
    const ctrl = new ProjectSettingsAutosaveController({
      delayMs: 800,
      schedule: (fn) => {
        fn()
        return { cancel: () => {} }
      },
      persist: async (next) => {
        if (fail) throw new Error('disk')
        writes.push(next)
        return 'saved'
      },
      onSuccess: () => { success.push('ok') },
      onError: (error) => { errors.push(error) },
    })
    ctrl.syncServer(stored, stored)
    ctrl.focusText()
    ctrl.setDraft(draft({ details: '未落盘' }))
    await ctrl.idle()
    expect(writes).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(success).toHaveLength(0)
    expect(ctrl.baseline.details).toBe('注明页码')
    fail = false
    ctrl.setDraft(draft({ details: '再试一次' }))
    await ctrl.idle()
    expect(writes.map((next) => next.details)).toEqual(['再试一次'])
    expect(success).toEqual(['ok'])
  })

  it('flushes a pending edit onto the captured project before later drafts are ignored', async () => {
    const env = harness()
    env.ctrl.focusText()
    env.ctrl.setDraft(draft({ details: '离开前' }))
    env.advance(100)
    const flushed = env.ctrl.flush()
    env.ctrl.suspend()
    env.setSlug('other')
    env.ctrl.setDraft(draft({ details: '不应写入' }))
    await flushed
    expect(env.writes).toEqual([{ draft: draft({ details: '离开前' }), slug: 'xuncha' }])
  })

  it('does not let a blocked write clobber the baseline', async () => {
    const ctrl = new ProjectSettingsAutosaveController({
      persist: async () => 'blocked',
      onSuccess: () => { throw new Error('should not toast') },
      onError: () => { throw new Error('should not toast an error') },
    })
    ctrl.syncServer(stored, stored)
    ctrl.setDraft(draft({ historySearch: true }))
    await ctrl.idle()
    expect(ctrl.baseline.historySearch).toBe(false)
  })
})
