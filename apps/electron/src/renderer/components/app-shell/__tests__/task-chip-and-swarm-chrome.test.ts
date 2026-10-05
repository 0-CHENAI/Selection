import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const taskMenuSrc = readFileSync(join(__dirname, '../TaskActionMenu.tsx'), 'utf8')
const sessionListSrc = readFileSync(join(__dirname, '../SessionList.tsx'), 'utf8')
const sessionItemSrc = readFileSync(join(__dirname, '../SessionItem.tsx'), 'utf8')
const chatPageSrc = readFileSync(join(__dirname, '../../../pages/ChatPage.tsx'), 'utf8')
const chatDisplaySrc = readFileSync(join(__dirname, '../ChatDisplay.tsx'), 'utf8')

describe('sub-agent chip title and width (#205)', () => {
  it('uses the shared chip label helper and default width', () => {
    expect(taskMenuSrc).toContain('resolveBackgroundTaskChipLabel')
    expect(taskMenuSrc).toContain('TASK_CHIP_WIDTH_CLASS')
    expect(taskMenuSrc).not.toContain('max-w-[220px]')
  })
})

describe('swarm title chrome (#206)', () => {
  it('does not render the orchestration green dot on list rows or the chat header', () => {
    expect(sessionItemSrc).not.toContain('OrchestrationStatusBadge')
    expect(chatPageSrc).not.toContain('OrchestrationStatusBadge')
    expect(chatPageSrc).not.toContain('SwarmRunDetailsDialog')
    expect(chatPageSrc).not.toContain('setSwarmDetailsOpen')
  })

  it('places a single subagent window trigger in the chat header after create-and-run', () => {
    expect(chatPageSrc).toContain('OrchestrationRunProgress')
    expect(chatPageSrc).toContain('runningHint={orchestrationStatus === \'running\'}')
    expect(chatPageSrc.match(/\{orchestrationProgress\}/g)).toHaveLength(1)
    expect(chatPageSrc).toContain('renderPreviewSession={renderOrchestrationNode}')
  })
})

describe('running orchestration composer chrome', () => {
  it('treats a running swarm/DAG as busy so the last turn and send button stay in-flight', () => {
    expect(chatDisplaySrc).toContain('const sessionBusy = Boolean(sessionIsProcessing || swarmRunning)')
    expect(chatDisplaySrc).toContain('isTaskOrchestrationRunning: Boolean(swarmRunning && sessionTaskSlug && !sessionParentId)')
    expect(chatDisplaySrc).toContain('isProcessing: sessionBusy')
    expect(chatDisplaySrc).toContain('onRegenerate={isLastResponse && !turn.isStreaming && !sessionBusy')
    expect(chatDisplaySrc).toContain('{sessionBusy && (() => {')
    expect(chatDisplaySrc).toContain('stopTask')
    expect(chatDisplaySrc).toContain('stopSessionSwarm')
    expect(chatDisplaySrc).toContain('pickStoppableTaskRun')
    expect(chatPageSrc).toContain('canPreviewOrchestrationChild')
    expect(chatPageSrc).toContain('sessionId={sessionId}')
  })
})

describe('running child preview (#207)', () => {
  it('keeps execution children out of the conversation sidebar, including legacy unowned executions', () => {
    expect(sessionListSrc).not.toContain('ExecutionChildren')
    expect(sessionListSrc).not.toContain('unownedExecutions')
    expect(sessionListSrc).toContain('executionChildren.some(child => child.id === selectedId)')
  })

  it('opens a preview overlay instead of navigating away from the parent', () => {
    expect(chatDisplaySrc).toContain('onPreviewSession')
    expect(chatDisplaySrc).toContain('shouldPreviewBackgroundTask')
    expect(chatPageSrc).toContain('ChildSessionPreviewDialog')
    expect(chatPageSrc).toContain('onPreviewSession={setPreviewChildSessionId}')
  })

  it('keeps the parent task bar clickable and does not steal the chat focus zone', () => {
    const previewSrc = readFileSync(join(__dirname, '../ChildSessionPreviewDialog.tsx'), 'utf8')
    expect(previewSrc).toContain('modal={false}')
    expect(previewSrc).toContain('overlay={false}')
    expect(previewSrc).toContain('portalContainer={container}')
    expect(chatPageSrc).toContain('ref={setChildPreviewContainer}')
    expect(previewSrc).toContain('enableFocusZone={false}')
    expect(previewSrc).toContain('deriveSessionMessagesLoadState')
    expect(previewSrc).toContain('key={displaySession.id}')
    expect(chatPageSrc).toContain('setPreviewChildSessionId(null)')
  })
})
