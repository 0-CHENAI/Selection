/**
 * Autosave for the project page.
 *
 * Switches and the working-folder picker commit immediately. Text and the
 * color control wait out a short pause, and a text blur commits at once.
 * One editing session shows a single success toast; a failed write leaves
 * the draft untouched so the form can keep what the user typed.
 */

import { projectSettingsDraftDirty, type ProjectSettingsDraft } from './project-settings-draft'

export const PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS = 800

const IMMEDIATE_FIELDS = ['historySearch', 'workingDirectory'] as const

export interface ProjectSettingsSaveContext {
  workspaceId?: string
  slug?: string
  storedWorkingDirectory?: string
}

export type ProjectSettingsSaveResult = 'saved' | 'blocked'

export function projectSettingsDraftEqual(left: ProjectSettingsDraft, right: ProjectSettingsDraft): boolean {
  return !projectSettingsDraftDirty(left, right)
}

/**
 * Values that would actually be written.
 * An empty name or a cleared folder stays at the stored value (neither can be
 * wiped). Other text is trimmed so a trailing space does not save forever.
 */
export function projectSettingsPersistableDraft(
  stored: ProjectSettingsDraft,
  draft: ProjectSettingsDraft,
): ProjectSettingsDraft {
  return {
    name: draft.name.trim() || stored.name.trim(),
    description: draft.description.trim(),
    workingDirectory: draft.workingDirectory.trim() || stored.workingDirectory.trim(),
    details: draft.details.trim(),
    historySearch: draft.historySearch,
    color: draft.color.trim(),
  }
}

export function projectSettingsNeedsSave(stored: ProjectSettingsDraft, draft: ProjectSettingsDraft): boolean {
  return projectSettingsDraftDirty(stored, projectSettingsPersistableDraft(stored, draft))
}

/**
 * `0` commits now. `null` means the persistable draft matches what is stored.
 * Text, description, instructions, and color share the debounce delay.
 */
export function projectSettingsAutosaveDelay(
  stored: ProjectSettingsDraft,
  draft: ProjectSettingsDraft,
  delayMs = PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS,
): number | null {
  const next = projectSettingsPersistableDraft(stored, draft)
  if (!projectSettingsDraftDirty(stored, next)) return null
  const immediate = IMMEDIATE_FIELDS.some((field) => next[field] !== stored[field])
  return immediate ? 0 : delayMs
}

export function projectSettingsPatch(draft: ProjectSettingsDraft): {
  name: string
  description?: string
  workingDirectory?: string
  details?: string
  historySearchEnabled: boolean
  color?: string
} {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    workingDirectory: draft.workingDirectory.trim() || undefined,
    details: draft.details.trim() || undefined,
    historySearchEnabled: draft.historySearch,
    color: draft.color.trim() || undefined,
  }
}

export interface ProjectAutosaveNotice {
  /** Text fields currently focused. A move between them stays one session. */
  focused: number
  /** Success toast already shown for the open text session. */
  toasted: boolean
}

export function createProjectAutosaveNotice(): ProjectAutosaveNotice {
  return { focused: 0, toasted: false }
}

export function projectAutosaveNoticeFocus(state: ProjectAutosaveNotice): ProjectAutosaveNotice {
  if (state.focused === 0) return { focused: 1, toasted: false }
  return { focused: state.focused + 1, toasted: state.toasted }
}

export function projectAutosaveNoticeBlur(state: ProjectAutosaveNotice): ProjectAutosaveNotice {
  return { focused: Math.max(0, state.focused - 1), toasted: state.toasted }
}

/** A text session toasts once. A discrete change outside that session toasts every time. */
export function projectAutosaveNoticeSuccess(
  state: ProjectAutosaveNotice,
): { state: ProjectAutosaveNotice; toast: boolean } {
  if (state.toasted) return { state, toast: false }
  if (state.focused === 0) return { state: { focused: 0, toasted: false }, toast: true }
  return { state: { ...state, toasted: true }, toast: true }
}

export function projectAutosaveNoticeFailure(state: ProjectAutosaveNotice): ProjectAutosaveNotice {
  return { ...state, toasted: false }
}

export interface ProjectSettingsAutosaveControllerOptions {
  persist: (draft: ProjectSettingsDraft, context: ProjectSettingsSaveContext) => Promise<ProjectSettingsSaveResult>
  onSuccess: () => void
  onError: (error: unknown) => void
  capture?: () => ProjectSettingsSaveContext
  delayMs?: number
  schedule?: (callback: () => void, delayMs: number) => { cancel: () => void }
  deferFocus?: (callback: () => void) => void
}

const EMPTY_DRAFT: ProjectSettingsDraft = {
  name: '',
  description: '',
  workingDirectory: '',
  details: '',
  historySearch: false,
  color: '',
}

function defaultSchedule(callback: () => void, delayMs: number): { cancel: () => void } {
  const timer = setTimeout(callback, delayMs)
  return { cancel: () => clearTimeout(timer) }
}

/**
 * Serializes project setting writes. Call `suspend` before the page swaps
 * projects so a stale keystroke cannot land on the next slug; `flush` first
 * so the previous draft is still written.
 */
export class ProjectSettingsAutosaveController {
  private stored: ProjectSettingsDraft = { ...EMPTY_DRAFT }
  private draft: ProjectSettingsDraft = { ...EMPTY_DRAFT }
  private notice: ProjectAutosaveNotice = createProjectAutosaveNotice()
  private tail: Promise<void> = Promise.resolve()
  private timer: { cancel: () => void } | null = null
  private suspended = false
  private pendingBlur = false

  constructor(private readonly options: ProjectSettingsAutosaveControllerOptions) {}

  get baseline(): ProjectSettingsDraft {
    return this.stored
  }

  /** Replace the baseline from a load. Does not write. */
  syncServer(server: ProjectSettingsDraft, draft: ProjectSettingsDraft): void {
    this.suspended = false
    this.stored = server
    this.draft = draft
    this.cancelTimer()
    if (!projectSettingsNeedsSave(server, draft)) return
    this.queue(projectSettingsAutosaveDelay(server, draft, this.delayMs) ?? 0)
  }

  setDraft(next: ProjectSettingsDraft): void {
    if (this.suspended) return
    const changed = projectSettingsDraftDirty(this.draft, next)
    this.draft = next
    if (!changed) return
    const delay = projectSettingsAutosaveDelay(this.stored, next, this.delayMs)
    if (delay === null) {
      this.cancelTimer()
      return
    }
    this.queue(delay)
  }

  focusText(): void {
    if (this.pendingBlur) {
      this.pendingBlur = false
      return
    }
    this.notice = projectAutosaveNoticeFocus(this.notice)
  }

  blurText(): void {
    this.pendingBlur = true
    const pending = this.flush()
    this.defer(() => {
      if (!this.pendingBlur) return
      this.pendingBlur = false
      this.notice = projectAutosaveNoticeBlur(this.notice)
      void pending.then(() => {
        if (this.pendingBlur || this.notice.focused > 0) return
        this.notice = { focused: 0, toasted: false }
      })
    })
  }

  /** Write whatever is still pending, including a debounce that has not fired. */
  flush(): Promise<void> {
    this.cancelTimer()
    return this.enqueue()
  }

  /** Ignore further drafts until the next `syncServer`. */
  suspend(): void {
    this.cancelTimer()
    this.suspended = true
  }

  idle(): Promise<void> {
    return this.tail
  }

  private get delayMs(): number {
    return this.options.delayMs ?? PROJECT_SETTINGS_AUTOSAVE_DEBOUNCE_MS
  }

  private queue(delayMs: number): void {
    this.cancelTimer()
    if (this.suspended) return
    if (delayMs <= 0) {
      void this.enqueue()
      return
    }
    const schedule = this.options.schedule ?? defaultSchedule
    this.timer = schedule(() => {
      this.timer = null
      void this.enqueue()
    }, delayMs)
  }

  private enqueue(): Promise<void> {
    const baseline = this.stored
    const saving = projectSettingsPersistableDraft(baseline, this.draft)
    const context = this.options.capture?.() ?? {}
    if (!projectSettingsDraftDirty(baseline, saving)) return this.tail
    const job = this.tail.then(() => this.commit(baseline, saving, context))
    this.tail = job.then(() => {}, () => {})
    return job
  }

  private async commit(
    baseline: ProjectSettingsDraft,
    saving: ProjectSettingsDraft,
    context: ProjectSettingsSaveContext,
  ): Promise<void> {
    if (!projectSettingsDraftDirty(baseline, saving)) return
    if (!projectSettingsDraftEqual(this.stored, baseline) && !projectSettingsDraftDirty(this.stored, saving)) return
    let outcome: ProjectSettingsSaveResult
    try {
      outcome = await this.options.persist(saving, context)
    } catch (error) {
      this.notice = projectAutosaveNoticeFailure(this.notice)
      this.options.onError(error)
      return
    }
    if (outcome !== 'saved') return
    if (projectSettingsDraftEqual(this.stored, baseline)) this.stored = saving
    const decision = projectAutosaveNoticeSuccess(this.notice)
    this.notice = decision.state
    if (decision.toast) this.options.onSuccess()
    if (this.suspended) return
    if (!projectSettingsNeedsSave(this.stored, this.draft)) return
    this.queue(projectSettingsAutosaveDelay(this.stored, this.draft, this.delayMs) ?? 0)
  }

  private cancelTimer(): void {
    this.timer?.cancel()
    this.timer = null
  }

  private defer(callback: () => void): void {
    const deferFocus = this.options.deferFocus ?? queueMicrotask
    deferFocus(callback)
  }
}
