/**
 * useAutomations
 *
 * Encapsulates all automations state management:
 * - Loading automations from automations.json
 * - Subscribing to live updates
 * - Test, toggle, duplicate, delete handlers
 * - Delete confirmation state
 * - Syncing automations to Jotai atom for cross-component access
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { automationsAtom } from '@/atoms/automations'
import { parseAutomationsConfig, type AutomationConditionUI, type AutomationListItem, type TestResult, type ExecutionEntry, type ExecutionStatus } from '@/components/automations/types'
import type { TestAutomationResult } from '../../shared/types'
import {
  CREATION_COMPLETED_EVENT,
  type CreationCompletedEventDetail,
} from '@/lib/creation-job-validation'

export const AUTOMATION_TEST_MISSING_SESSION_ERROR = 'Test started but did not return a valid session ID.'
const AUTOMATION_TEST_NO_ACTIONS_ERROR = 'No actions to execute'

export interface ResolvedAutomationTestResult {
  testResult: TestResult
  sessionId?: string
  missingSessionId: boolean
}

/**
 * Convert the protocol response into the renderer state and the one session that
 * should be opened. Keeping this pure makes the navigation contract testable:
 * webhook-only runs never navigate, while only a successful prompt with a
 * non-empty session id can become the navigation target.
 */
export function resolveAutomationTestResult(
  result: TestAutomationResult,
  expectsPrompt: boolean,
): ResolvedAutomationTestResult {
  const actions = Array.isArray(result.actions) ? result.actions : []
  if (actions.length === 0) {
    return {
      testResult: { state: 'error', stderr: AUTOMATION_TEST_NO_ACTIONS_ERROR },
      missingSessionId: false,
    }
  }

  const promptResults = actions.filter(action => action.type === 'prompt')
  const successfulPromptResults = promptResults.filter(action => action.success)
  const validPromptResult = successfulPromptResults.find(action => action.sessionId?.trim())
  const missingSessionId = expectsPrompt && (
    successfulPromptResults.some(action => !action.sessionId?.trim()) ||
    promptResults.length === 0
  )

  const errors = actions
    .map(action => ('stderr' in action ? action.stderr : 'error' in action ? action.error : undefined))
    .filter((message): message is string => Boolean(message))
  if (missingSessionId) errors.push(AUTOMATION_TEST_MISSING_SESSION_ERROR)

  const hasError = actions.some(action => !action.success) || missingSessionId
  const duration = actions.reduce((sum, action) => sum + (action.duration ?? 0), 0)

  return {
    testResult: {
      state: hasError ? 'error' : 'success',
      stderr: errors.length > 0 ? errors.join('\n') : undefined,
      duration: duration || undefined,
    },
    sessionId: expectsPrompt ? validPromptResult?.sessionId?.trim() : undefined,
    missingSessionId,
  }
}

export interface AutomationRequestTracker {
  begin(key: string): number | null
  isCurrent(key: string, token: number): boolean
  finish(key: string, token: number): void
  reset(): void
}

/** Synchronous guard for duplicate clicks plus invalidation for stale responses. */
export function createAutomationRequestTracker(): AutomationRequestTracker {
  let nextToken = 0
  const active = new Map<string, number>()

  return {
    begin(key) {
      if (active.has(key)) return null
      const token = ++nextToken
      active.set(key, token)
      return token
    },
    isCurrent(key, token) {
      return active.get(key) === token
    },
    finish(key, token) {
      if (active.get(key) === token) active.delete(key)
    },
    reset() {
      active.clear()
    },
  }
}

export function isCurrentAutomationLoad(
  requestWorkspaceId: string,
  requestSequence: number,
  activeWorkspaceId: string | null | undefined,
  latestRequestSequence: number,
): boolean {
  return requestWorkspaceId === activeWorkspaceId && requestSequence === latestRequestSequence
}

export function shouldRefreshAutomations(
  changedWorkspaceId: string,
  activeWorkspaceId: string | null | undefined,
): boolean {
  return Boolean(activeWorkspaceId) && changedWorkspaceId === activeWorkspaceId
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function inferSimulateCommand(conditions: AutomationConditionUI[] | undefined): string | undefined {
  if (!conditions) return undefined
  for (const condition of conditions) {
    if (condition.condition === 'state' && condition.contains && (
      condition.field === 'tool_input.command' || condition.field === 'toolInput.command'
    )) {
      return condition.contains
    }
    if ((condition.condition === 'and' || condition.condition === 'or' || condition.condition === 'not') && condition.conditions) {
      const nested = inferSimulateCommand(condition.conditions)
      if (nested) return nested
    }
  }
  return undefined
}

function mapAutomationHistoryStatus(ok: boolean, status?: string): ExecutionStatus {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'matched':
    case 'scheduled':
    case 'running':
    case 'rate-limited':
    case 'suppressed':
    case 'blocked':
      return status
    default:
      return ok ? 'success' : 'error'
  }
}

async function loadAutomationsFromServer(workspaceId: string): Promise<AutomationListItem[]> {
  const json = await window.electronAPI.getAutomations(workspaceId)
  if (!json) return [] // No automations configured yet
  return parseAutomationsConfig(json)
}

export interface UseAutomationsResult {
  automations: AutomationListItem[]
  automationTestResults: Record<string, TestResult>
  automationPendingDelete: string | null
  pendingDeleteAutomation: AutomationListItem | undefined
  setAutomationPendingDelete: (id: string | null) => void
  handleTestAutomation: (automationId: string) => void
  handleSimulateMatch: (automationId: string) => void
  handleToggleAutomation: (automationId: string) => void
  handleDuplicateAutomation: (automationId: string) => void
  handleDeleteAutomation: (automationId: string) => void
  confirmDeleteAutomation: () => void
  getAutomationHistory: (automationId: string) => Promise<ExecutionEntry[]>
  handleReplayAutomation: (automationId: string, event: string) => void
}

export function useAutomations(
  activeWorkspaceId: string | null | undefined,
  onNavigateToSession?: (sessionId: string) => void,
): UseAutomationsResult {
  const { t } = useTranslation()
  const [automations, setAutomations] = useState<AutomationListItem[]>([])
  const [automationTestResults, setAutomationTestResults] = useState<Record<string, TestResult>>({})
  const [automationPendingDelete, setAutomationPendingDelete] = useState<string | null>(null)
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId
  const loadRequestSequenceRef = useRef(0)
  const automationCacheRef = useRef(new Map<string, AutomationListItem[]>())
  const requestTrackerRef = useRef<AutomationRequestTracker | null>(null)
  if (!requestTrackerRef.current) requestTrackerRef.current = createAutomationRequestTracker()

  // Test state belongs to one workspace. Resetting the tracker also makes every
  // delayed response from the previous workspace stale before it can navigate.
  useEffect(() => {
    requestTrackerRef.current?.reset()
    setAutomationTestResults({})
    setAutomations(activeWorkspaceId ? automationCacheRef.current.get(activeWorkspaceId) ?? [] : [])
  }, [activeWorkspaceId])

  // Sync automations to Jotai atom for cross-component access (MainContentPanel)
  const setAutomationsAtom = useSetAtom(automationsAtom)
  useEffect(() => {
    setAutomationsAtom(automations)
  }, [automations, setAutomationsAtom])

  // Load automations from server and hydrate lastExecutedAt from history in one step.
  // This avoids the race where a config reload wipes timestamps before the
  // history effect can re-merge them.
  const loadAndHydrate = useCallback(async (expectedId?: string) => {
    if (!activeWorkspaceId) return
    const requestWorkspaceId = activeWorkspaceId
    const requestSequence = ++loadRequestSequenceRef.current
    const isCurrentRequest = () => isCurrentAutomationLoad(
      requestWorkspaceId,
      requestSequence,
      activeWorkspaceIdRef.current,
      loadRequestSequenceRef.current,
    )
    try {
      const items = await loadAutomationsFromServer(requestWorkspaceId)
      if (expectedId && !items.some((item) => item.id === expectedId)) {
        throw new Error(`Created automation "${expectedId}" was not visible after refresh.`)
      }
      try {
        const map = await window.electronAPI.getAutomationLastExecuted(requestWorkspaceId)
        for (const item of items) {
          item.lastExecutedAt = map[item.id] ?? item.lastExecutedAt
        }
      } catch { /* history unavailable — timestamps stay undefined */ }
      if (isCurrentRequest()) {
        automationCacheRef.current.set(requestWorkspaceId, items)
        setAutomations(items)
      }
    } catch (error) {
      // A transient read/parse failure must not flash a false empty state or
      // overwrite a newer successful refresh. Keep the last known-good list.
      if (isCurrentRequest()) {
        console.warn('[Automations] Failed to refresh automations; keeping the previous list:', error)
      }
      if (expectedId) throw error
    }
  }, [activeWorkspaceId])

  // Initial load
  useEffect(() => {
    loadAndHydrate()
  }, [loadAndHydrate])

  // Subscribe to live automations updates (when automations.json changes on disk)
  useEffect(() => {
    if (!activeWorkspaceId) return
    const cleanup = window.electronAPI.onAutomationsChanged((changedWorkspaceId) => {
      if (!shouldRefreshAutomations(changedWorkspaceId, activeWorkspaceIdRef.current)) return
      void loadAndHydrate()
    })
    return () => { cleanup() }
  }, [activeWorkspaceId, loadAndHydrate])

  // The creation reconciler has already verified persistence. Refresh directly
  // as well as listening to the file watcher so the new item is immediately
  // visible even when watcher delivery is delayed or coalesced.
  useEffect(() => {
    const handleCreationCompleted = (event: Event) => {
      const detail = (event as CustomEvent<CreationCompletedEventDetail>).detail
      if (detail?.kind !== 'automation' || detail.workspaceId !== activeWorkspaceIdRef.current) return
      detail.waitUntil(loadAndHydrate(detail.id))
    }
    window.addEventListener(CREATION_COMPLETED_EVENT, handleCreationCompleted)
    return () => window.removeEventListener(CREATION_COMPLETED_EVENT, handleCreationCompleted)
  }, [loadAndHydrate])

  // Shared lookup — avoids repeating automations.find() in every callback
  const findAutomation = useCallback((id: string) => automations.find(h => h.id === id), [automations])

  // Test automation — aggregate all action results
  const handleTestAutomation = useCallback((automationId: string) => {
    const automation = findAutomation(automationId)
    if (!automation || !activeWorkspaceId) return

    const requestWorkspaceId = activeWorkspaceId
    const requestKey = `${requestWorkspaceId}:${automationId}`
    const tracker = requestTrackerRef.current!
    const requestToken = tracker.begin(requestKey)
    if (requestToken == null) return

    const isCurrentRequest = () => (
      activeWorkspaceIdRef.current === requestWorkspaceId &&
      tracker.isCurrent(requestKey, requestToken)
    )

    const executable = automation.actions.filter((a): a is Extract<typeof a, { type: 'prompt' | 'webhook' }> => a.type === 'prompt' || a.type === 'webhook')
    if (executable.length === 0) {
      const message = automation.actions.some(a => a.type === 'decision')
        ? 'Decision actions cannot be executed by Run Test. Use Simulate match.'
        : AUTOMATION_TEST_NO_ACTIONS_ERROR
      setAutomationTestResults(prev => ({
        ...prev,
        [automationId]: {
          state: 'error',
          stderr: message,
        },
      }))
      toast.error(message)
      tracker.finish(requestKey, requestToken)
      return
    }

    setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'running' } }))

    void window.electronAPI.testAutomation({
      workspaceId: requestWorkspaceId,
      automationId: automation.id,
      automationName: automation.name,
      actions: executable,
      permissionMode: automation.permissionMode,
      labels: automation.labels,
      telegramTopic: automation.telegramTopic,
    }).then((result) => {
      if (!isCurrentRequest()) return
      const resolved = resolveAutomationTestResult(result, executable.some(action => action.type === 'prompt'))
      setAutomationTestResults(prev => ({
        ...prev,
        [automationId]: resolved.testResult,
      }))
      if (resolved.testResult.state === 'error') {
        toast.error(resolved.testResult.stderr || t('automations.testFailed'))
      }
      if (resolved.sessionId) onNavigateToSession?.(resolved.sessionId)
    }).catch((error: unknown) => {
      if (!isCurrentRequest()) return
      const message = normalizeError(error)
      setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'error', stderr: message } }))
      toast.error(message)
    }).finally(() => {
      tracker.finish(requestKey, requestToken)
    })
  }, [findAutomation, activeWorkspaceId, onNavigateToSession, t])

  const handleSimulateMatch = useCallback((automationId: string) => {
    const automation = findAutomation(automationId)
    if (!automation || !activeWorkspaceId) return

    const requestWorkspaceId = activeWorkspaceId
    const requestKey = `${requestWorkspaceId}:${automationId}`
    const tracker = requestTrackerRef.current!
    const requestToken = tracker.begin(requestKey)
    if (requestToken == null) return
    const isCurrentRequest = () => (
      activeWorkspaceIdRef.current === requestWorkspaceId &&
      tracker.isCurrent(requestKey, requestToken)
    )

    setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'running', mode: 'match' } }))

    const exactTool = automation.matcher?.match(/^\^([A-Za-z][A-Za-z0-9_-]*)\$$/)?.[1]
    void window.electronAPI.testAutomation({
      workspaceId: requestWorkspaceId,
      automationId: automation.id,
      automationName: automation.name,
      actions: automation.actions.filter((a): a is Extract<typeof a, { type: 'prompt' | 'webhook' }> => a.type === 'prompt' || a.type === 'webhook'),
      dryRun: true,
      event: automation.event,
      sample: {
        tool_name: exactTool ?? 'Bash',
        tool_input: { command: inferSimulateCommand(automation.conditions) ?? 'echo hi' },
        prompt: 'test',
        stop_reason: 'complete',
        source: 'startup',
        agent_type: 'session',
      },
    }).then((result) => {
      if (!isCurrentRequest()) return
      const matches = result.matches ?? []
      setAutomationTestResults(prev => ({
        ...prev,
        [automationId]: {
          state: 'success',
          mode: 'match',
          matches,
        },
      }))
    }).catch((error: unknown) => {
      if (!isCurrentRequest()) return
      const message = normalizeError(error)
      setAutomationTestResults(prev => ({ ...prev, [automationId]: { state: 'error', mode: 'match', stderr: message } }))
      toast.error(message)
    }).finally(() => {
      tracker.finish(requestKey, requestToken)
    })
  }, [findAutomation, activeWorkspaceId])

  const handleToggleAutomation = useCallback((automationId: string) => {
    const automation = findAutomation(automationId)
    if (!automation || !activeWorkspaceId) return
    window.electronAPI.setAutomationEnabled(
      activeWorkspaceId,
      automation.event,
      automation.matcherIndex,
      !automation.enabled,
    ).catch(() => {
      toast.error(t('toast.failedToToggleAutomation'))
    })
  }, [findAutomation, activeWorkspaceId, t])

  const handleDuplicateAutomation = useCallback((automationId: string) => {
    const automation = findAutomation(automationId)
    if (!automation || !activeWorkspaceId) return
    window.electronAPI.duplicateAutomation(activeWorkspaceId, automation.event, automation.matcherIndex)
      .catch(() => toast.error(t('toast.failedToDuplicateAutomation')))
  }, [findAutomation, activeWorkspaceId, t])

  // Delete: show confirmation dialog
  const handleDeleteAutomation = useCallback((automationId: string) => {
    setAutomationPendingDelete(automationId)
  }, [])

  const pendingDeleteAutomation = automationPendingDelete ? findAutomation(automationPendingDelete) : undefined

  const confirmDeleteAutomation = useCallback(() => {
    if (!pendingDeleteAutomation || !activeWorkspaceId) return
    window.electronAPI.deleteAutomation(activeWorkspaceId, pendingDeleteAutomation.event, pendingDeleteAutomation.matcherIndex)
      .catch(() => toast.error(t('toast.failedToDeleteAutomation')))
    setAutomationPendingDelete(null)
  }, [pendingDeleteAutomation, activeWorkspaceId, t])

  // Fetch execution history for a specific automation
  const getAutomationHistory = useCallback(async (automationId: string): Promise<ExecutionEntry[]> => {
    if (!activeWorkspaceId) return []
    try {
      const entries = await window.electronAPI.getAutomationHistory(activeWorkspaceId, automationId, 20)
      const automation = findAutomation(automationId)
      return entries.map(e => ({
        id: `${e.id}-${e.ts}`,
        automationId: e.id,
        event: automation?.event ?? 'LabelAdd',
        status: mapAutomationHistoryStatus(e.ok, (e as { status?: string }).status),
        duration: e.webhook?.durationMs ?? (e as { durationMs?: number }).durationMs ?? 0,
        timestamp: e.ts,
        sessionId: e.sessionId,
        actionSummary: e.webhook
          ? `Webhook ${e.webhook.method} ${e.webhook.url}${e.webhook.attempts && e.webhook.attempts > 1 ? ` (${e.webhook.attempts} attempts)` : ''}`
          : e.prompt,
        error: e.webhook?.error ?? e.error,
        webhookDetails: e.webhook ? {
          method: e.webhook.method,
          url: e.webhook.url,
          statusCode: e.webhook.statusCode,
          durationMs: e.webhook.durationMs,
          attempts: e.webhook.attempts,
          error: e.webhook.error,
          responseBody: e.webhook.responseBody,
        } : undefined,
      }))
    } catch {
      return []
    }
  }, [activeWorkspaceId, findAutomation])

  // Replay failed webhook actions for a specific automation
  const handleReplayAutomation = useCallback((automationId: string, event: string) => {
    if (!activeWorkspaceId) return
    window.electronAPI.replayAutomation(activeWorkspaceId, automationId, event)
      .then(() => {
        toast.success(t('toast.webhookReplayCompleted'))
      })
      .catch((err: Error) => {
        toast.error(t("toast.replayFailed", { error: err.message }))
      })
  }, [activeWorkspaceId, t])

  return {
    automations,
    automationTestResults,
    automationPendingDelete,
    pendingDeleteAutomation,
    setAutomationPendingDelete,
    handleTestAutomation,
    handleSimulateMatch,
    handleToggleAutomation,
    handleDuplicateAutomation,
    handleDeleteAutomation,
    confirmDeleteAutomation,
    getAutomationHistory,
    handleReplayAutomation,
  }
}
